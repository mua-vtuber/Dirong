import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { redactSensitiveText } from "../errors.js";
import { formatLocaleText, t } from "../i18n/catalog.js";
import type {
  SttProvider,
  SttTranscriptionContext,
  SttTranscriptionOptions,
  SttTranscriptionResult,
} from "./provider.js";

const OPENAI_TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";
const OPENAI_AUDIO_UPLOAD_LIMIT_BYTES = 25 * 1024 * 1024;

export class OpenAiSttProvider implements SttProvider {
  readonly providerName = "openai";
  readonly supportsPrompt: boolean;

  constructor(
    private readonly apiKey: string,
    readonly modelName: string,
    private readonly defaultTimeoutMs: number,
  ) {
    this.supportsPrompt = !modelName.includes("diarize");
  }

  async transcribe(
    inputAudioPath: string,
    context: SttTranscriptionContext,
    options?: SttTranscriptionOptions,
  ): Promise<SttTranscriptionResult> {
    if (!this.apiKey.trim()) {
      throw new Error(t("ko", "runtimeCli.sttProvider.openAiKeyMissing"));
    }

    const audioStat = await stat(inputAudioPath);
    if (audioStat.size > OPENAI_AUDIO_UPLOAD_LIMIT_BYTES) {
      throw new Error(
        formatLocaleText("ko", "runtimeCli.sttProvider.openAiFileTooLarge", {
          bytes: audioStat.size,
        }),
      );
    }

    const bytes = await readFile(inputAudioPath);
    const audioBody = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const form = new FormData();
    form.append(
      "file",
      new Blob([audioBody], { type: contentTypeForAudioPath(inputAudioPath) }),
      path.basename(inputAudioPath),
    );
    form.append("model", this.modelName);
    form.append("response_format", "json");

    if (context.language) {
      form.append("language", context.language);
    }
    if (this.supportsPrompt && context.prompt) {
      form.append("prompt", context.prompt);
    }

    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(OPENAI_TRANSCRIPTIONS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: form,
        signal: controller.signal,
      });

      const body = await response.text();
      if (!response.ok) {
        throw new Error(
          `OpenAI STT API failed (${response.status}): ${extractOpenAiError(body)}`,
        );
      }

      const parsed = parseTranscriptionResponse(body);
      return { text: parsed.text.trim() };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`OpenAI STT API timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseTranscriptionResponse(body: string): { text: string } {
  const parsed = JSON.parse(body) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("text" in parsed) ||
    typeof parsed.text !== "string"
  ) {
    throw new Error(t("ko", "runtimeCli.sttProvider.openAiTextMissing"));
  }
  return { text: parsed.text };
}

function extractOpenAiError(body: string): string {
  let message = body;
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: unknown; type?: unknown; code?: unknown };
    };
    const error = parsed.error;
    if (error?.message) {
      message = [
        String(error.message),
        error.type ? `type=${String(error.type)}` : "",
        error.code ? `code=${String(error.code)}` : "",
      ].filter(Boolean).join(" ");
    }
  } catch {
    // Keep the raw body fallback below.
  }

  const redacted = redactSensitiveText(message);
  return redacted.length <= 1000 ? redacted : `${redacted.slice(0, 1000)}...`;
}

function contentTypeForAudioPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".wav") {
    return "audio/wav";
  }
  if (ext === ".webm") {
    return "audio/webm";
  }
  if (ext === ".mp3" || ext === ".mpeg" || ext === ".mpga") {
    return "audio/mpeg";
  }
  if (ext === ".m4a" || ext === ".mp4") {
    return "audio/mp4";
  }
  if (ext === ".ogg") {
    return "audio/ogg";
  }
  return "application/octet-stream";
}
