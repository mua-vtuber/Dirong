import { DirongError, redactSensitiveText } from "../errors.js";
import { runProcess } from "../media.js";
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
};

export class LocalWhisperSttProvider implements SttProvider {
  readonly providerName = "local-whisper";
  readonly supportsPrompt = false;
  readonly modelName: string;

  constructor(private readonly config: LocalWhisperProviderConfig) {
    this.modelName = config.model;
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
        "local-whisper 실행 준비에 실패했습니다.",
        `command: ${displayCommand(this.config.command, this.config.args)}`,
        `model: ${this.modelName}`,
        `device: ${this.config.device}`,
        `computeType: ${this.config.computeType}`,
        summarizeProcessOutput(result.stderr || result.stdout),
      ].filter(Boolean).join(" "));
    }
  }

  async transcribe(
    inputAudioPath: string,
    context: SttTranscriptionContext,
    options?: SttTranscriptionOptions,
  ): Promise<SttTranscriptionResult> {
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

  throw new Error("local-whisper wrapper stdout에서 JSON text 필드를 찾지 못했습니다.");
}

function displayCommand(command: string, args: string[]): string {
  return redactSensitiveText([command, ...args].join(" "));
}

function summarizeProcessOutput(value: string): string {
  const redacted = redactSensitiveText(value).trim();
  if (!redacted) {
    return "stderr/stdout output 없음";
  }
  return redacted.length <= 1000 ? redacted : `${redacted.slice(0, 1000)}...`;
}
