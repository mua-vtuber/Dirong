import { spawn } from "node:child_process";
import process from "node:process";
import type { Readable, Writable } from "node:stream";
import { resolveShellFalseCommand } from "../../process/run-child.js";

export const DEFAULT_CLAUDE_PERSISTENT_SMOKE_ARGS = [
  "--input-format",
  "stream-json",
  "--output-format",
  "stream-json",
  "--verbose",
] as const;

export const DEFAULT_CLAUDE_PERSISTENT_SMOKE_TIMEOUT_MS = 120_000;
export const DEFAULT_CLAUDE_STREAM_JSON_MAX_BUFFER_BYTES = 1024 * 1024;
export const DEFAULT_CLAUDE_STREAM_JSON_MAX_DIAGNOSTIC_LINES = 200;

export type ClaudePersistentSmokeChildProcess = {
  readonly pid?: number;
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  readonly killed: boolean;
  kill(signal?: NodeJS.Signals | number): boolean;
  on(
    event: "error",
    listener: (error: Error) => void,
  ): ClaudePersistentSmokeChildProcess;
  on(
    event: "exit",
    listener: (
      code: number | null,
      signal: NodeJS.Signals | null,
    ) => void,
  ): ClaudePersistentSmokeChildProcess;
};

export type ClaudePersistentSmokeSpawnOptions = {
  stdio: ["pipe", "pipe", "pipe"];
  shell: false;
  windowsHide: true;
};

export type ClaudePersistentSmokeSpawn = (
  command: string,
  args: string[],
  options: ClaudePersistentSmokeSpawnOptions,
) => ClaudePersistentSmokeChildProcess;

export type ClaudePersistentSmokeSessionOptions = {
  command?: string;
  extraArgs?: string[];
  model?: string | null;
  timeoutMs?: number;
  platform?: NodeJS.Platform;
  spawnProcess?: ClaudePersistentSmokeSpawn;
  now?: () => number;
  maxStreamBufferBytes?: number;
  maxDiagnosticLines?: number;
};

export type ClaudePersistentSmokeResolvedOptions = {
  requestedCommand: string;
  requestedArgs: string[];
  spawnedCommand: string;
  spawnedArgs: string[];
  model: string | null;
  timeoutMs: number;
};

export type ClaudePersistentSmokeLineObservation = {
  rawLine: string;
  parsed: Record<string, unknown> | null;
  type: string | null;
  assistantText: string;
  sessionId: string | null;
  isResult: boolean;
  parseError: string | null;
};

export type ClaudePersistentSmokeTurnResult = {
  prompt: string;
  requestPayload: string;
  wroteBytes: number;
  pidBeforeWrite: number | null;
  pidAfterResult: number | null;
  resultReceived: boolean;
  resultLine: string | null;
  assistantText: string;
  sessionId: string | null;
  stdoutLines: string[];
  stderrLines: string[];
  timedOut: boolean;
  outputExceeded: boolean;
  durationMs: number;
  processAliveAfterResult: boolean;
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
  error: string | null;
  diagnostics: ClaudeStreamJsonDiagnostics;
};

export type ClaudeStreamJsonDiagnostics = {
  stdoutLineCount: number;
  stdoutBytes: number;
  stderrLineCount: number;
  eventTypeCounts: Record<string, number>;
  lastEventType: string | null;
  firstStdoutAfterMs: number | null;
  lastStdoutAfterMs: number | null;
  malformedLineCount: number;
  resultReceived: boolean;
};

export type ClaudePersistentSmokeRequestProgress = {
  kind:
    | "started"
    | "waiting_for_first_stream_event"
    | "stream_event"
    | "result_boundary_received"
    | "failed";
  pid: number | null;
  diagnostics: ClaudeStreamJsonDiagnostics;
  warning: string | null;
};

export type ClaudePersistentSmokeKillResult = {
  killRequested: boolean;
  exited: boolean;
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
};

type WaitForLineResult =
  | { kind: "line"; line: string }
  | { kind: "timeout" }
  | { kind: "exit" }
  | { kind: "error"; error: Error }
  | { kind: "output_exceeded"; error: string };

export class ClaudePersistentSmokeSession {
  readonly requestedCommand: string;
  readonly requestedArgs: string[];
  readonly spawnedCommand: string;
  readonly spawnedArgs: string[];
  readonly model: string | null;
  readonly timeoutMs: number;

  private readonly spawnProcess: ClaudePersistentSmokeSpawn;
  private readonly now: () => number;
  private readonly maxStreamBufferBytes: number;
  private readonly maxDiagnosticLines: number;
  private child: ClaudePersistentSmokeChildProcess | null = null;
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
  private sessionId: string | null = null;
  private activeMaxOutputBytes: number | null = null;
  private activeOutputBytes = 0;
  private activeOutputExceededError: string | null = null;

  constructor(options: ClaudePersistentSmokeSessionOptions = {}) {
    const resolved = resolveClaudePersistentSmokeOptions(options);
    this.requestedCommand = resolved.requestedCommand;
    this.requestedArgs = resolved.requestedArgs;
    this.spawnedCommand = resolved.spawnedCommand;
    this.spawnedArgs = resolved.spawnedArgs;
    this.model = resolved.model;
    this.timeoutMs = resolved.timeoutMs;
    this.spawnProcess = options.spawnProcess ?? defaultSpawnProcess;
    this.now = options.now ?? Date.now;
    this.maxStreamBufferBytes = readPositiveIntegerOption(
      options.maxStreamBufferBytes,
      DEFAULT_CLAUDE_STREAM_JSON_MAX_BUFFER_BYTES,
      "maxStreamBufferBytes",
    );
    this.maxDiagnosticLines = readPositiveIntegerOption(
      options.maxDiagnosticLines,
      DEFAULT_CLAUDE_STREAM_JSON_MAX_DIAGNOSTIC_LINES,
      "maxDiagnosticLines",
    );
  }

  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  get capturedSessionId(): string | null {
    return this.sessionId;
  }

  get stderrSnapshot(): string[] {
    return [...this.stderrLines];
  }

  start(): void {
    if (this.child && this.isAlive()) {
      return;
    }

    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    this.stdoutLines.length = 0;
    this.stderrLines.length = 0;
    this.processExited = false;
    this.processError = null;
    this.exitCode = null;
    this.exitSignal = null;
    this.activeOutputExceededError = null;

    const child = this.spawnProcess(this.spawnedCommand, this.spawnedArgs, {
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
    });
    child.on("exit", (code, signal) => {
      this.flushStdout();
      this.flushStderr();
      this.processExited = true;
      this.exitCode = code;
      this.exitSignal = signal;
      this.notifyStdoutWaiters();
      this.notifyExitWaiters();
    });
  }

  async request(
    prompt: string,
    options: {
      timeoutMs?: number;
      maxOutputBytes?: number;
      progress?: (progress: ClaudePersistentSmokeRequestProgress) => void;
    } = {},
  ): Promise<ClaudePersistentSmokeTurnResult> {
    if (!prompt.trim()) {
      throw new Error("Claude persistent smoke prompt must not be empty.");
    }
    this.beginRequestOutputLimit(options.maxOutputBytes);

    this.start();

    const child = this.child;
    if (!child) {
      throw new Error("Claude persistent smoke process was not started.");
    }

    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const startedAt = this.now();
    const stderrStartIndex = this.stderrLines.length;
    const payload = buildClaudePersistentSmokePayload(prompt);
    const payloadWithNewline = `${payload}\n`;
    const stdoutLines: string[] = [];
    let assistantText = "";
    let resultLine: string | null = null;
    let resultReceived = false;
    let timedOut = false;
    let outputExceeded = false;
    let outputBytes = 0;
    let error: string | null = null;
    const eventTypeCounts: Record<string, number> = {};
    let lastEventType: string | null = null;
    let firstStdoutAfterMs: number | null = null;
    let lastStdoutAfterMs: number | null = null;
    let malformedLineCount = 0;

    const makeDiagnostics = (): ClaudeStreamJsonDiagnostics => ({
      stdoutLineCount: stdoutLines.length,
      stdoutBytes: Math.max(outputBytes, this.activeOutputBytes),
      stderrLineCount: Math.max(0, this.stderrLines.length - stderrStartIndex),
      eventTypeCounts: { ...eventTypeCounts },
      lastEventType,
      firstStdoutAfterMs,
      lastStdoutAfterMs,
      malformedLineCount,
      resultReceived,
    });
    const emitProgress = (
      kind: ClaudePersistentSmokeRequestProgress["kind"],
      warning: string | null = null,
    ): void => {
      try {
        options.progress?.({
          kind,
          pid: this.child?.pid ?? null,
          diagnostics: makeDiagnostics(),
          warning,
        });
      } catch {
        // Progress observation must never affect protocol handling.
      }
    };

    const pidBeforeWrite = child.pid ?? null;
    emitProgress("started");
    const writeError = await writeStdin(child.stdin, payloadWithNewline);
    if (writeError) {
      error = writeError.message;
      emitProgress("failed", error);
      const result = this.buildTurnResult({
        prompt,
        payload,
        wroteBytes: Buffer.byteLength(payloadWithNewline),
        pidBeforeWrite,
        stdoutLines,
        stderrStartIndex,
        assistantText,
        resultReceived,
        resultLine,
        timedOut,
        outputExceeded,
        startedAt,
        error,
        diagnostics: makeDiagnostics(),
      });
      this.clearRequestOutputLimit();
      return result;
    }
    emitProgress("waiting_for_first_stream_event");

    while (!resultReceived && !timedOut && !error) {
      const elapsedMs = this.now() - startedAt;
      const remainingMs = Math.max(1, timeoutMs - elapsedMs);
      const next = await this.waitForNextStdoutLine(remainingMs);

      if (next.kind === "timeout") {
        timedOut = true;
        error = `stream-json timeout: result not received; ${formatClaudeStreamJsonDiagnostics(makeDiagnostics())}`;
        emitProgress("failed", error);
        this.kill();
        break;
      }
      if (next.kind === "exit") {
        error = "Claude persistent smoke process exited before result.";
        emitProgress("failed", `${error} ${formatClaudeStreamJsonDiagnostics(makeDiagnostics())}`);
        break;
      }
      if (next.kind === "error") {
        error = next.error.message;
        emitProgress("failed", error);
        break;
      }
      if (next.kind === "output_exceeded") {
        outputExceeded = true;
        error = `${next.error}; ${formatClaudeStreamJsonDiagnostics(makeDiagnostics())}`;
        emitProgress("failed", error);
        break;
      }

      pushRingLine(stdoutLines, next.line, this.maxDiagnosticLines);
      outputBytes += Buffer.byteLength(`${next.line}\n`, "utf8");
      const observedAtMs = this.now() - startedAt;
      firstStdoutAfterMs ??= observedAtMs;
      lastStdoutAfterMs = observedAtMs;
      if (
        options.maxOutputBytes !== undefined &&
        outputBytes > options.maxOutputBytes
      ) {
        outputExceeded = true;
        error = `stream-json output exceeded max bytes; ${formatClaudeStreamJsonDiagnostics(makeDiagnostics())}`;
        emitProgress("failed", error);
        this.kill();
        break;
      }
      const observation = parseClaudeStreamJsonLine(next.line);
      if (observation.parseError) {
        malformedLineCount += 1;
        error = `stream-json protocol error: malformed stdout line; ${formatClaudeStreamJsonDiagnostics(makeDiagnostics())}`;
        emitProgress("failed", error);
        this.kill();
        break;
      }
      lastEventType = observation.type ?? "unknown";
      eventTypeCounts[lastEventType] =
        (eventTypeCounts[lastEventType] ?? 0) + 1;
      if (observation.sessionId) {
        this.sessionId = observation.sessionId;
      }
      if (observation.assistantText) {
        assistantText += observation.assistantText;
      }
      if (observation.isResult) {
        resultReceived = true;
        resultLine = next.line;
        emitProgress("result_boundary_received");
      } else {
        emitProgress("stream_event");
      }
    }

    const result = this.buildTurnResult({
      prompt,
      payload,
      wroteBytes: Buffer.byteLength(payloadWithNewline),
      pidBeforeWrite,
      stdoutLines,
      stderrStartIndex,
      assistantText,
      resultReceived,
      resultLine,
      timedOut,
      outputExceeded,
      startedAt,
      error,
      diagnostics: makeDiagnostics(),
    });
    this.clearRequestOutputLimit();
    return result;
  }

  isAlive(): boolean {
    return Boolean(this.child && !this.child.killed && !this.processExited);
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    const child = this.child;
    if (!child || child.killed || this.processExited) {
      return false;
    }

    const killRequested = child.kill(signal);
    const forceKillTimer = setTimeout(() => {
      if (this.child === child && !child.killed && !this.processExited) {
        child.kill("SIGKILL");
      }
    }, 1_000);
    forceKillTimer.unref?.();
    return killRequested;
  }

  async killAndWait(timeoutMs = 1_000): Promise<ClaudePersistentSmokeKillResult> {
    const killRequested = this.kill();
    const exited = await this.waitForExit(timeoutMs);
    return {
      killRequested,
      exited,
      exitCode: this.exitCode,
      exitSignal: this.exitSignal,
    };
  }

  private buildTurnResult(input: {
    prompt: string;
    payload: string;
    wroteBytes: number;
    pidBeforeWrite: number | null;
    stdoutLines: string[];
    stderrStartIndex: number;
    assistantText: string;
    resultReceived: boolean;
    resultLine: string | null;
    timedOut: boolean;
    outputExceeded: boolean;
    startedAt: number;
    error: string | null;
    diagnostics: ClaudeStreamJsonDiagnostics;
  }): ClaudePersistentSmokeTurnResult {
    return {
      prompt: input.prompt,
      requestPayload: input.payload,
      wroteBytes: input.wroteBytes,
      pidBeforeWrite: input.pidBeforeWrite,
      pidAfterResult: this.child?.pid ?? null,
      resultReceived: input.resultReceived,
      resultLine: input.resultLine,
      assistantText: input.assistantText,
      sessionId: this.sessionId,
      stdoutLines: input.stdoutLines,
      stderrLines: this.stderrLinesSince(input.stderrStartIndex),
      timedOut: input.timedOut,
      outputExceeded: input.outputExceeded,
      durationMs: this.now() - input.startedAt,
      processAliveAfterResult: this.isAlive(),
      exitCode: this.exitCode,
      exitSignal: this.exitSignal,
      error: input.error,
      diagnostics: input.diagnostics,
    };
  }

  private pushStdout(chunk: string): void {
    if (this.rejectOversizedStdoutChunk(chunk)) {
      return;
    }
    this.stdoutBuffer += chunk;
    const lines = this.stdoutBuffer.split("\n");
    this.stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        pushRingLine(
          this.stdoutLines,
          this.truncateDiagnosticLine(trimmed),
          this.maxDiagnosticLines,
        );
      }
    }
    this.notifyStdoutWaiters();
  }

  private flushStdout(): void {
    const trimmed = this.stdoutBuffer.trim();
    if (trimmed) {
      pushRingLine(
        this.stdoutLines,
        this.truncateDiagnosticLine(trimmed),
        this.maxDiagnosticLines,
      );
      this.stdoutBuffer = "";
      this.notifyStdoutWaiters();
    }
  }

  private pushStderr(chunk: string): void {
    if (this.rejectOversizedStderrChunk(chunk)) {
      return;
    }
    this.stderrBuffer += chunk;
    const lines = this.stderrBuffer.split("\n");
    this.stderrBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        pushRingLine(
          this.stderrLines,
          this.truncateDiagnosticLine(trimmed),
          this.maxDiagnosticLines,
        );
      }
    }
  }

  private flushStderr(): void {
    const trimmed = this.stderrBuffer.trim();
    if (trimmed) {
      pushRingLine(
        this.stderrLines,
        this.truncateDiagnosticLine(trimmed),
        this.maxDiagnosticLines,
      );
      this.stderrBuffer = "";
    }
  }

  private waitForNextStdoutLine(timeoutMs: number): Promise<WaitForLineResult> {
    if (this.activeOutputExceededError) {
      return Promise.resolve({
        kind: "output_exceeded",
        error: this.activeOutputExceededError,
      });
    }
    const existingLine = this.stdoutLines.shift();
    if (existingLine !== undefined) {
      return Promise.resolve({ kind: "line", line: existingLine });
    }
    if (this.processError) {
      return Promise.resolve({ kind: "error", error: this.processError });
    }
    if (this.processExited) {
      return Promise.resolve({ kind: "exit" });
    }

    return new Promise<WaitForLineResult>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const waiter = (): void => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        removeArrayValue(this.stdoutWaiters, waiter);
        const line = this.stdoutLines.shift();
        if (this.activeOutputExceededError) {
          resolve({
            kind: "output_exceeded",
            error: this.activeOutputExceededError,
          });
        } else if (line !== undefined) {
          resolve({ kind: "line", line });
        } else if (this.processError) {
          resolve({ kind: "error", error: this.processError });
        } else if (this.processExited) {
          resolve({ kind: "exit" });
        } else {
          resolve({ kind: "timeout" });
        }
      };

      timer = setTimeout(() => {
        removeArrayValue(this.stdoutWaiters, waiter);
        resolve({ kind: "timeout" });
      }, timeoutMs);
      this.stdoutWaiters.push(waiter);
    });
  }

  private beginRequestOutputLimit(maxOutputBytes: number | undefined): void {
    this.activeMaxOutputBytes = maxOutputBytes ?? null;
    this.activeOutputBytes = 0;
    this.activeOutputExceededError = null;
  }

  private clearRequestOutputLimit(): void {
    this.activeMaxOutputBytes = null;
    this.activeOutputBytes = 0;
    this.activeOutputExceededError = null;
  }

  private rejectOversizedStdoutChunk(chunk: string): boolean {
    const chunkBytes = Buffer.byteLength(chunk, "utf8");
    const projectedOutputBytes = this.activeOutputBytes + chunkBytes;
    if (
      this.activeMaxOutputBytes !== null &&
      projectedOutputBytes > this.activeMaxOutputBytes
    ) {
      this.activeOutputBytes = projectedOutputBytes;
      this.failForOutputExceeded(
        `stream-json stdout exceeded max bytes before newline (${projectedOutputBytes}/${this.activeMaxOutputBytes})`,
      );
      return true;
    }
    this.activeOutputBytes = projectedOutputBytes;

    if (wouldExceedUnterminatedBuffer(this.stdoutBuffer, chunk, this.maxStreamBufferBytes)) {
      this.failForOutputExceeded(
        `stream-json stdout buffer exceeded max bytes before newline (${this.maxStreamBufferBytes})`,
      );
      return true;
    }
    return false;
  }

  private rejectOversizedStderrChunk(chunk: string): boolean {
    if (wouldExceedUnterminatedBuffer(this.stderrBuffer, chunk, this.maxStreamBufferBytes)) {
      this.failForOutputExceeded(
        `stream-json stderr buffer exceeded max bytes before newline (${this.maxStreamBufferBytes})`,
      );
      return true;
    }
    return false;
  }

  private failForOutputExceeded(error: string): void {
    this.activeOutputExceededError ??= error;
    this.kill();
    this.notifyStdoutWaiters();
  }

  private truncateDiagnosticLine(line: string): string {
    const bytes = Buffer.byteLength(line, "utf8");
    if (bytes <= this.maxStreamBufferBytes) {
      return line;
    }
    const tail = Buffer.from(line, "utf8")
      .subarray(Math.max(0, bytes - this.maxStreamBufferBytes))
      .toString("utf8");
    return `[truncated ${bytes - Buffer.byteLength(tail, "utf8")} bytes]${tail}`;
  }

  private stderrLinesSince(startIndex: number): string[] {
    if (startIndex < this.stderrLines.length) {
      return this.stderrLines.slice(startIndex);
    }
    return this.stderrLines.length >= this.maxDiagnosticLines
      ? [...this.stderrLines]
      : [];
  }

  private waitForExit(timeoutMs: number): Promise<boolean> {
    if (!this.child || this.processExited) {
      return Promise.resolve(this.processExited);
    }

    return new Promise<boolean>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const waiter = (): void => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        removeArrayValue(this.exitWaiters, waiter);
        resolve(true);
      };

      timer = setTimeout(() => {
        removeArrayValue(this.exitWaiters, waiter);
        resolve(false);
      }, timeoutMs);
      this.exitWaiters.push(waiter);
    });
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
}

export function resolveClaudePersistentSmokeOptions(
  options: ClaudePersistentSmokeSessionOptions = {},
): ClaudePersistentSmokeResolvedOptions {
  const requestedCommand = options.command?.trim() || "claude";
  const model =
    options.model === undefined
      ? null
      : options.model?.trim() || null;
  const timeoutMs =
    options.timeoutMs ?? DEFAULT_CLAUDE_PERSISTENT_SMOKE_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Claude persistent smoke timeoutMs must be a positive integer.");
  }

  const requestedArgs = buildClaudePersistentSmokeArgs(
    model,
    options.extraArgs ?? [],
  );
  const resolved = resolveShellFalseCommand(
    requestedCommand,
    requestedArgs,
    options.platform ?? process.platform,
  );

  return {
    requestedCommand,
    requestedArgs,
    spawnedCommand: resolved.command,
    spawnedArgs: resolved.args,
    model,
    timeoutMs,
  };
}

export function buildClaudePersistentSmokeArgs(
  model: string | null,
  extraArgs: string[] = [],
): string[] {
  const args: string[] = [
    ...DEFAULT_CLAUDE_PERSISTENT_SMOKE_ARGS,
    ...extraArgs,
  ];
  if (model && model !== "default") {
    args.push("--model", model);
  }
  return args;
}

export function buildClaudePersistentSmokePayload(prompt: string): string {
  return JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: prompt,
    },
  });
}

export function parseClaudeStreamJsonLine(
  line: string,
): ClaudePersistentSmokeLineObservation {
  try {
    const parsed: unknown = JSON.parse(line);
    if (!isRecord(parsed)) {
      return {
        rawLine: line,
        parsed: null,
        type: null,
        assistantText: "",
        sessionId: null,
        isResult: false,
        parseError: "JSON line is not an object.",
      };
    }

    const type = typeof parsed.type === "string" ? parsed.type : null;
    const sessionId =
      typeof parsed.session_id === "string" ? parsed.session_id : null;
    return {
      rawLine: line,
      parsed,
      type,
      assistantText: type === "assistant" ? extractAssistantText(parsed) : "",
      sessionId,
      isResult: type === "result",
      parseError: null,
    };
  } catch (error) {
    return {
      rawLine: line,
      parsed: null,
      type: null,
      assistantText: "",
      sessionId: null,
      isResult: false,
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}

export function formatClaudeStreamJsonDiagnostics(
  diagnostics: ClaudeStreamJsonDiagnostics,
): string {
  const eventTypes = Object.entries(diagnostics.eventTypeCounts)
    .map(([type, count]) => `${type}:${count}`)
    .join(",");
  return [
    `eventTypes=${eventTypes || "none"}`,
    `stdoutLines=${diagnostics.stdoutLineCount}`,
    `stdoutBytes=${diagnostics.stdoutBytes}`,
    `stderrLines=${diagnostics.stderrLineCount}`,
    `lastEvent=${diagnostics.lastEventType ?? "none"}`,
    `resultReceived=${diagnostics.resultReceived}`,
  ].join("; ");
}

export function renderCommandDisplay(command: string, args: string[]): string {
  return [command, ...args.map(renderCommandArg)].join(" ");
}

export { resolveShellFalseCommand };


function extractAssistantText(event: Record<string, unknown>): string {
  const message = event.message;
  if (isRecord(message)) {
    const contentText = extractTextContentBlocks(message.content);
    if (contentText) {
      return contentText;
    }
  }

  return (
    extractTextContentBlocks(event.content) ||
    extractAnyText(event.text) ||
    extractAnyText(event.output)
  );
}

function extractTextContentBlocks(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (!isRecord(item)) {
          return extractAnyText(item);
        }
        if (item.type && item.type !== "text") {
          return "";
        }
        return extractAnyText(item.text) || extractAnyText(item.content);
      })
      .filter((text) => text.length > 0)
      .join("");
  }
  if (isRecord(value)) {
    if (value.type && value.type !== "text") {
      return "";
    }
    return extractAnyText(value.text) || extractAnyText(value.content);
  }
  return "";
}

function extractAnyText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(extractAnyText).join("");
  }
  if (isRecord(value)) {
    return (
      extractAnyText(value.text) ||
      extractAnyText(value.content) ||
      extractAnyText(value.value) ||
      extractAnyText(value.output_text) ||
      extractAnyText(value.delta) ||
      extractAnyText(value.message)
    );
  }
  return "";
}

function renderCommandArg(arg: string): string {
  if (arg.length === 0) {
    return '""';
  }
  return /\s/.test(arg) ? JSON.stringify(arg) : arg;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function defaultSpawnProcess(
  command: string,
  args: string[],
  options: ClaudePersistentSmokeSpawnOptions,
): ClaudePersistentSmokeChildProcess {
  return spawn(command, args, options) as unknown as ClaudePersistentSmokeChildProcess;
}

function readPositiveIntegerOption(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved <= 0) {
    throw new Error(`Claude persistent smoke ${name} must be a positive integer.`);
  }
  return resolved;
}

function pushRingLine(
  lines: string[],
  line: string,
  maxLines: number,
): void {
  lines.push(line);
  while (lines.length > maxLines) {
    lines.shift();
  }
}

function wouldExceedUnterminatedBuffer(
  currentBuffer: string,
  chunk: string,
  maxBytes: number,
): boolean {
  const lastNewlineIndex = chunk.lastIndexOf("\n");
  const pendingTail =
    lastNewlineIndex >= 0 ? chunk.slice(lastNewlineIndex + 1) : chunk;
  const projected = lastNewlineIndex >= 0
    ? pendingTail
    : `${currentBuffer}${pendingTail}`;
  return Buffer.byteLength(projected, "utf8") > maxBytes;
}

function writeStdin(stream: Writable, payload: string): Promise<Error | null> {
  return new Promise((resolve) => {
    stream.write(payload, "utf8", (error: Error | null | undefined) => {
      resolve(error ?? null);
    });
  });
}

function removeArrayValue<T>(values: T[], value: T): void {
  const index = values.indexOf(value);
  if (index >= 0) {
    values.splice(index, 1);
  }
}
