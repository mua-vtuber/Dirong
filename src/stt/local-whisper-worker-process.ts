import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { redactSensitiveText } from "../errors.js";
import { resolveShellFalseCommand } from "../process/run-child.js";

export const LOCAL_WHISPER_ONE_SHOT_SCRIPT = "local-whisper-json.py";
export const LOCAL_WHISPER_WORKER_SCRIPT = "local-whisper-worker.py";
export const DEFAULT_LOCAL_WHISPER_WORKER_READY_TIMEOUT_MS = 120_000;
const DEFAULT_LOCAL_WHISPER_WORKER_STOP_TIMEOUT_MS = 1_000;
const DEFAULT_LOCAL_WHISPER_WORKER_MAX_LINE_BYTES = 1024 * 1024;
const DEFAULT_LOCAL_WHISPER_WORKER_MAX_DIAGNOSTIC_LINES = 80;

export type LocalWhisperWorkerChildProcess = {
  readonly pid?: number;
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  readonly killed: boolean;
  kill(signal?: NodeJS.Signals | number): boolean;
  on(
    event: "error",
    listener: (error: Error) => void,
  ): LocalWhisperWorkerChildProcess;
  on(
    event: "exit",
    listener: (
      code: number | null,
      signal: NodeJS.Signals | null,
    ) => void,
  ): LocalWhisperWorkerChildProcess;
};

export type LocalWhisperWorkerSpawnOptions = {
  stdio: ["pipe", "pipe", "pipe"];
  shell: false;
  windowsHide: true;
};

export type LocalWhisperWorkerSpawn = (
  command: string,
  args: string[],
  options: LocalWhisperWorkerSpawnOptions,
) => LocalWhisperWorkerChildProcess;

export type LocalWhisperWorkerProcessOptions = {
  command: string;
  args: string[];
  model: string;
  device: string;
  computeType: string;
  spawnProcess?: LocalWhisperWorkerSpawn;
  readyTimeoutMs?: number;
  maxLineBytes?: number;
  maxDiagnosticLines?: number;
};

export type LocalWhisperWorkerRequest = {
  id: string;
  inputAudioPath: string;
  language: string | null;
  timeoutMs: number;
  signal?: AbortSignal;
};

export type LocalWhisperWorkerResult = {
  text: string;
};

type WaitLineResult =
  | { kind: "line"; line: string }
  | { kind: "timeout" }
  | { kind: "aborted" }
  | { kind: "exit" }
  | { kind: "error"; error: Error };

export class LocalWhisperWorkerProcess {
  private readonly spawnProcess: LocalWhisperWorkerSpawn;
  private readonly readyTimeoutMs: number;
  private readonly maxLineBytes: number;
  private readonly maxDiagnosticLines: number;
  private child: LocalWhisperWorkerChildProcess | null = null;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private readonly stdoutLines: string[] = [];
  private readonly stderrLines: string[] = [];
  private readonly stdoutWaiters: Array<() => void> = [];
  private readonly exitWaiters: Array<() => void> = [];
  private processExited = false;
  private processError: Error | null = null;
  private exitCode: number | null = null;
  private exitSignal: NodeJS.Signals | null = null;
  private requestInFlight = false;

  constructor(private readonly options: LocalWhisperWorkerProcessOptions) {
    this.spawnProcess = options.spawnProcess ?? defaultSpawnProcess;
    this.readyTimeoutMs =
      options.readyTimeoutMs ?? DEFAULT_LOCAL_WHISPER_WORKER_READY_TIMEOUT_MS;
    this.maxLineBytes =
      options.maxLineBytes ?? DEFAULT_LOCAL_WHISPER_WORKER_MAX_LINE_BYTES;
    this.maxDiagnosticLines =
      options.maxDiagnosticLines ?? DEFAULT_LOCAL_WHISPER_WORKER_MAX_DIAGNOSTIC_LINES;
  }

  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  get stderrSnapshot(): string {
    return this.stderrLines.join("\n");
  }

  isAlive(): boolean {
    return Boolean(this.child && !this.processExited && !this.processError);
  }

  async start(input?: {
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<void> {
    if (this.isAlive()) {
      return;
    }

    this.resetProcessState();
    const resolved = resolveShellFalseCommand(this.options.command, [
      ...this.options.args,
      "--model",
      this.options.model,
      "--device",
      this.options.device,
      "--compute-type",
      this.options.computeType,
    ]);
    const child = this.spawnProcess(resolved.command, resolved.args, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });
    this.child = child;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string | Buffer) => {
      this.pushStdout(String(chunk));
    });
    child.stdout.on("end", () => {
      this.flushStdout();
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string | Buffer) => {
      this.pushStderr(String(chunk));
    });
    child.stderr.on("end", () => {
      this.flushStderr();
    });
    child.on("error", (error) => {
      this.processError = error;
      this.notifyStdoutWaiters();
      this.notifyExitWaiters();
    });
    child.on("exit", (code, signal) => {
      this.processExited = true;
      this.exitCode = code;
      this.exitSignal = signal;
      this.notifyStdoutWaiters();
      this.notifyExitWaiters();
    });

    const line = await this.waitForProtocolLine(
      input?.timeoutMs ?? this.readyTimeoutMs,
      input?.signal,
    );
    if (line.kind !== "line") {
      this.kill();
      throw new Error(`local-whisper worker failed to become ready: ${this.describeWaitFailure(line)}`);
    }

    let ready: Record<string, unknown>;
    try {
      ready = parseWorkerLine(line.line);
    } catch (error) {
      this.kill();
      throw error;
    }
    if (ready.type !== "ready") {
      this.kill();
      throw new Error(`local-whisper worker protocol error: expected ready, got ${ready.type ?? "unknown"}`);
    }
    if (ready.ok !== true) {
      this.kill();
      throw new Error(`local-whisper worker readiness failed: ${readWorkerError(ready)}`);
    }
  }

  async request(input: LocalWhisperWorkerRequest): Promise<LocalWhisperWorkerResult> {
    if (this.requestInFlight) {
      throw new Error("local-whisper worker already has an in-flight request");
    }
    if (!this.isAlive()) {
      await this.start({
        timeoutMs: input.timeoutMs,
        signal: input.signal,
      });
    }
    if (input.signal?.aborted) {
      this.kill();
      throw new Error("local-whisper worker request was cancelled before it started");
    }

    const child = this.child;
    if (!child) {
      throw new Error("local-whisper worker process was not started");
    }

    this.requestInFlight = true;
    try {
      await writeStdinLine(child.stdin, JSON.stringify({
        type: "transcribe",
        id: input.id,
        input: input.inputAudioPath,
        language: input.language,
      }));

      while (true) {
        const line = await this.waitForProtocolLine(input.timeoutMs, input.signal);
        if (line.kind !== "line") {
          this.kill();
          throw new Error(`local-whisper worker request failed: ${this.describeWaitFailure(line)}`);
        }

        let response: Record<string, unknown>;
        try {
          response = parseWorkerLine(line.line);
        } catch (error) {
          this.kill();
          throw error;
        }
        if (response.type !== "result") {
          continue;
        }
        if (response.id !== input.id) {
          this.kill();
          throw new Error(
            `local-whisper worker protocol error: expected response ${input.id}, got ${String(response.id)}`,
          );
        }
        if (response.ok !== true) {
          throw new Error(`local-whisper worker STT failed: ${readWorkerError(response)}`);
        }
        if (typeof response.text !== "string") {
          this.kill();
          throw new Error("local-whisper worker protocol error: response.text missing");
        }
        return { text: response.text.trim() };
      }
    } finally {
      this.requestInFlight = false;
    }
  }

  async stop(timeoutMs = DEFAULT_LOCAL_WHISPER_WORKER_STOP_TIMEOUT_MS): Promise<void> {
    const child = this.child;
    if (!child) {
      return;
    }

    if (this.isAlive() && !this.requestInFlight) {
      await writeStdinLine(child.stdin, JSON.stringify({ type: "shutdown" })).catch(() => undefined);
      await this.waitForExit(timeoutMs);
    }

    if (this.isAlive()) {
      this.kill();
      await this.waitForExit(timeoutMs);
    }
    this.child = null;
  }

  kill(): boolean {
    return this.child?.kill("SIGKILL") ?? false;
  }

  private async waitForProtocolLine(
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<WaitLineResult> {
    const line = this.stdoutLines.shift();
    if (line !== undefined) {
      return { kind: "line", line };
    }
    if (this.processError) {
      return { kind: "error", error: this.processError };
    }
    if (this.processExited) {
      return { kind: "exit" };
    }
    if (signal?.aborted) {
      return { kind: "aborted" };
    }

    return await new Promise<WaitLineResult>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let settled = false;
      const cleanup = (): void => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        signal?.removeEventListener("abort", onAbort);
        removeArrayValue(this.stdoutWaiters, waiter);
      };
      const finish = (result: WaitLineResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(result);
      };
      const onAbort = (): void => finish({ kind: "aborted" });
      const waiter = (): void => {
        const nextLine = this.stdoutLines.shift();
        if (nextLine !== undefined) {
          finish({ kind: "line", line: nextLine });
          return;
        }
        if (this.processError) {
          finish({ kind: "error", error: this.processError });
          return;
        }
        if (this.processExited) {
          finish({ kind: "exit" });
        }
      };

      timer = setTimeout(() => finish({ kind: "timeout" }), Math.max(1, timeoutMs));
      timer.unref?.();
      signal?.addEventListener("abort", onAbort, { once: true });
      this.stdoutWaiters.push(waiter);
    });
  }

  private async waitForExit(timeoutMs: number): Promise<boolean> {
    if (this.processExited || this.processError) {
      return true;
    }
    return await new Promise<boolean>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const cleanup = (): void => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        removeArrayValue(this.exitWaiters, waiter);
      };
      const waiter = (): void => {
        cleanup();
        resolve(true);
      };
      timer = setTimeout(() => {
        cleanup();
        resolve(false);
      }, Math.max(1, timeoutMs));
      timer.unref?.();
      this.exitWaiters.push(waiter);
    });
  }

  private describeWaitFailure(result: Exclude<WaitLineResult, { kind: "line" }>): string {
    if (result.kind === "timeout") {
      return `timeout; stderr: ${this.stderrSnapshotForError()}`;
    }
    if (result.kind === "aborted") {
      return "cancelled";
    }
    if (result.kind === "error") {
      return redactSensitiveText(result.error.message);
    }
    return `process exited code=${this.exitCode ?? "-"} signal=${this.exitSignal ?? "-"}; stderr: ${this.stderrSnapshotForError()}`;
  }

  private stderrSnapshotForError(): string {
    const text = redactSensitiveText(this.stderrSnapshot).trim();
    return text.length > 1000 ? `${text.slice(0, 1000)}...` : text || "(empty)";
  }

  private pushStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    if (Buffer.byteLength(this.stdoutBuffer, "utf8") > this.maxLineBytes) {
      this.processError = new Error("local-whisper worker stdout line exceeded max bytes");
      this.kill();
      this.notifyStdoutWaiters();
      this.notifyExitWaiters();
      return;
    }
    const lines = this.stdoutBuffer.split("\n");
    this.stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      this.stdoutLines.push(line.replace(/\r$/, ""));
    }
    this.notifyStdoutWaiters();
  }

  private flushStdout(): void {
    const trimmed = this.stdoutBuffer.trim();
    if (trimmed) {
      this.stdoutLines.push(trimmed);
    }
    this.stdoutBuffer = "";
    this.notifyStdoutWaiters();
  }

  private pushStderr(chunk: string): void {
    this.stderrBuffer += chunk;
    const lines = this.stderrBuffer.split("\n");
    this.stderrBuffer = lines.pop() ?? "";
    for (const line of lines) {
      pushRingLine(this.stderrLines, line.replace(/\r$/, ""), this.maxDiagnosticLines);
    }
  }

  private flushStderr(): void {
    const trimmed = this.stderrBuffer.trim();
    if (trimmed) {
      pushRingLine(this.stderrLines, trimmed, this.maxDiagnosticLines);
    }
    this.stderrBuffer = "";
  }

  private notifyStdoutWaiters(): void {
    for (const waiter of this.stdoutWaiters.splice(0)) {
      waiter();
    }
  }

  private notifyExitWaiters(): void {
    for (const waiter of this.exitWaiters.splice(0)) {
      waiter();
    }
  }

  private resetProcessState(): void {
    this.child = null;
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    this.stdoutLines.length = 0;
    this.stderrLines.length = 0;
    this.stdoutWaiters.length = 0;
    this.exitWaiters.length = 0;
    this.processExited = false;
    this.processError = null;
    this.exitCode = null;
    this.exitSignal = null;
    this.requestInFlight = false;
  }
}

export function buildLocalWhisperWorkerArgs(args: string[]): string[] | null {
  let replaced = false;
  const workerArgs = args.map((arg) => {
    if (pathBasename(arg) !== LOCAL_WHISPER_ONE_SHOT_SCRIPT) {
      return arg;
    }
    replaced = true;
    return arg.slice(0, arg.length - LOCAL_WHISPER_ONE_SHOT_SCRIPT.length) +
      LOCAL_WHISPER_WORKER_SCRIPT;
  });

  return replaced ? workerArgs : null;
}

function defaultSpawnProcess(
  command: string,
  args: string[],
  options: LocalWhisperWorkerSpawnOptions,
): LocalWhisperWorkerChildProcess {
  return spawn(command, args, options);
}

function parseWorkerLine(line: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through to the uniform protocol error.
  }
  throw new Error("local-whisper worker protocol error: malformed JSON line");
}

function readWorkerError(value: Record<string, unknown>): string {
  const error = value.error;
  return typeof error === "string" && error.trim()
    ? redactSensitiveText(error)
    : "unknown error";
}

async function writeStdinLine(stdin: Writable, line: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stdin.write(`${line}\n`, "utf8", (error?: Error | null) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function pushRingLine(lines: string[], line: string, maxLines: number): void {
  lines.push(line);
  while (lines.length > maxLines) {
    lines.shift();
  }
}

function removeArrayValue<T>(values: T[], value: T): void {
  const index = values.indexOf(value);
  if (index >= 0) {
    values.splice(index, 1);
  }
}

function pathBasename(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}
