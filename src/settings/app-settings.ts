import type { NotionRuntimeSettings } from "../notion/settings.js";
import type { AiProviderMode, AiProviderName } from "./ai-providers.js";

export type SttProviderName = "local-whisper" | "openai";

export type LocalWhisperSettings = {
  provider: "local-whisper";
  language: string;
  timeoutMs: number;
  localWhisper: {
    command: string;
    args: string[];
    model: string;
    device: string;
    computeType: string;
  };
};

export type OpenAiSttSettings = {
  provider: "openai";
  language: string;
  timeoutMs: number;
  openai: {
    apiKey: string;
    model: string;
  };
};

export type SttSettings = LocalWhisperSettings | OpenAiSttSettings;

export type AiCleanupRuntimeSettings = {
  provider: AiProviderName;
  mode: AiProviderMode;
  command: string;
  model: string | null;
  apiKey: string | null;
  claudeCommand: string;
  claudeModel: string | null;
  prepareTimeoutMs: number;
  autoCleanupEnabled: boolean;
  autoCleanupPollMs: number;
  autoCleanupSessionBatchLimit: number;
  readinessRetryMs: number;
  leaseMs: number | null;
  maxAttempts: number;
  maxInputChars: number;
  timeoutMs: number;
  maxOutputBytes: number;
};

export type AppSettings = {
  stt: SttSettings;
  aiCleanup: AiCleanupRuntimeSettings;
  notion: NotionRuntimeSettings;
};

export type SttSettingsOverrides = {
  provider?: SttProviderName | null;
  model?: string | null;
};
