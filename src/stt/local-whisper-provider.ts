import { DirongError, redactSensitiveText } from "../errors.js";
import { t } from "../i18n/catalog.js";
import { runProcess } from "../media.js";
import {
  buildLocalWhisperWorkerArgs,
  LocalWhisperWorkerProcess,
  type LocalWhisperWorkerSpawn,
} from "./local-whisper-worker-process.js";
import type {
  SttProvider,
  SttTranscriptionContext,
  SttTranscriptionOptions,
  SttTranscriptionResult,
} from "./provider.js";

export type LocalWhisperProviderConfig = {
  command: string;
  args: string[];
  model: string;
  device: string;
  computeType: string;
  defaultTimeoutMs: number;
  workerSpawnProcess?: LocalWhisperWorkerSpawn;
};

export class LocalWhisperSttProvider implements SttProvider {
  readonly providerName = "local-whisper";
  readonly supportsPrompt = false;
  readonly modelName: string;
  private readonly workerArgs: string[] | null;
  private readonly trackedPids = new Set<number>();
  private worker: LocalWhisperWorkerProcess | null = null;
  private persistentWorkerPrepared = false;

  constructor(private readonly config: LocalWhisperProviderConfig) {
    this.modelName = config.model;
    this.workerArgs = buildLocalWhisperWorkerArgs(config.args);
  }

  async preflight(): Promise<void> {
    const result = await runProcess(
      this.config.command,
      [
        ...this.config.args,
        "--check-model",
        "--model",
        this.modelName,
        "--device",
        this.config.device,
        "--compute-type",
        this.config.computeType,
      ],
      this.config.defaultTimeoutMs,
    );

    if (!result.ok) {
      throw new DirongError("LOCAL_WHISPER_PREFLIGHT_FAILED", [
        t("ko", "runtimeCli.sttProvider.localWhisperPreflightFailed"),
        `command: ${displayCommand(this.config.command, this.config.args)}`,
        `model: ${this.modelName}`,
        `device: ${this.config.device}`,
        `computeType: ${this.config.computeType}`,
        summarizeProcessOutput(result.stderr || result.stdout),
      ].filter(Boolean).join(" "));
    }
  }

  async prepare(options?: SttTranscriptionOptions): Promise<void> {
    if (!this.workerArgs) {
      await this.preflight();
      return;
    }

    await this.ensureWorker(
      options?.timeoutMs ?? this.config.defaultTimeoutMs,
      options?.signal,
    );
    this.persistentWorkerPrepared = true;
  }

  async transcribe(
    inputAudioPath: string,
    context: SttTranscriptionContext,
    options?: SttTranscriptionOptions,
  ): Promise<SttTranscriptionResult> {
    if (this.persistentWorkerPrepared) {
      const worker = await this.ensureWorker(
        options?.timeoutMs ?? this.config.defaultTimeoutMs,
        options?.signal,
      );
      return await worker.request({
        id: `${context.sessionId}:${context.chunkId}`,
        inputAudioPath,
        language: context.language,
        timeoutMs: options?.timeoutMs ?? this.config.defaultTimeoutMs,
        signal: options?.signal,
      });
    }

    const args = [
      ...this.config.args,
      "--input",
      inputAudioPath,
      "--model",
      this.modelName,
      "--device",
      this.config.device,
      "--compute-type",
      this.config.computeType,
    ];
    if (context.language) {
      args.push("--language", context.language);
    }

    const result = await runProcess(
      this.config.command,
      args,
      options?.timeoutMs ?? this.config.defaultTimeoutMs,
    );

    if (!result.ok) {
      const reason = result.timedOut
        ? `timeout after ${options?.timeoutMs ?? this.config.defaultTimeoutMs}ms`
        : summarizeProcessOutput(result.stderr || result.stdout);
      throw new Error(`local-whisper STT failed: ${reason}`);
    }

    return { text: parseLocalWhisperJson(result.stdout).text.trim() };
  }

  async stop(): Promise<void> {
    const worker = this.worker;
    const pid = worker?.pid ?? null;
    this.worker = null;
    this.persistentWorkerPrepared = false;
    await worker?.stop();
    if (pid !== null) {
      this.trackedPids.delete(pid);
    }
    for (const trackedPid of [...this.trackedPids]) {
      try {
        process.kill(trackedPid, "SIGKILL");
      } catch {
        // Best effort cleanup; the worker may already have exited.
      }
      this.trackedPids.delete(trackedPid);
    }
  }

  reapTrackedPids(): void {
    for (const pid of this.trackedPids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Exit handlers must stay quiet.
      }
    }
    this.trackedPids.clear();
  }

  private async ensureWorker(
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<LocalWhisperWorkerProcess> {
    if (!this.workerArgs) {
      throw new Error(
        `local-whisper persistent worker is unavailable for command: ${displayCommand(this.config.command, this.config.args)}`,
      );
    }

    if (this.worker?.isAlive()) {
      return this.worker;
    }

    const worker = new LocalWhisperWorkerProcess({
      command: this.config.command,
      args: this.workerArgs,
      model: this.modelName,
      device: this.config.device,
      computeType: this.config.computeType,
      readyTimeoutMs: timeoutMs,
      spawnProcess: this.config.workerSpawnProcess,
    });
    this.worker = worker;
    await worker.start({ timeoutMs, signal });
    const pid = worker.pid;
    if (pid !== null) {
      this.trackedPids.add(pid);
    }
    return worker;
  }
}

function parseLocalWhisperJson(stdout: string): { text: string } {
  const trimmed = stdout.trim();
  const candidates = [
    trimmed,
    ...trimmed.split(/\r?\n/).reverse().filter((line) => line.trim().startsWith("{")),
  ];

  for (const candidate of candidates) {
    if (!candidate.trim()) {
      continue;
    }

    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "text" in parsed &&
        typeof parsed.text === "string"
      ) {
        return { text: parsed.text };
      }
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error(t("ko", "runtimeCli.sttProvider.localWhisperTextMissing"));
}

function displayCommand(command: string, args: string[]): string {
  return redactSensitiveText([command, ...args].join(" "));
}

function summarizeProcessOutput(value: string): string {
  const redacted = redactSensitiveText(value).trim();
  if (!redacted) {
    return t("ko", "runtimeCli.sttProvider.noStdoutOrStderr");
  }
  return redacted.length <= 1000 ? redacted : `${redacted.slice(0, 1000)}...`;
}
