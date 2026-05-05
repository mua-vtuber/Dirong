import path from "node:path";
import dotenv from "dotenv";
import { MissingRequiredConfigError } from "./errors.js";
import { loadSttSettingsFromEnv } from "./settings/env-settings-loader.js";
import type { SttProviderName, SttSettings } from "./settings/app-settings.js";

export type SttSafeFormat = "webm" | "wav";

export type Phase0Config = {
  discordBotToken: string;
  discordClientId: string;
  guildId: string;
  voiceChannelId: string;
  dataDir: string;
  silenceMs: number;
  maxChunkMs: number;
  sttSafeFormat: SttSafeFormat;
  enableDave: boolean;
  decryptionFailureTolerance: number;
  debugVoice: boolean;
  autoRegisterCommands: boolean;
};

export type Phase0ConfigSnapshot = Omit<Phase0Config, "discordBotToken"> & {
  discordBotToken: "[REDACTED]" | "[MISSING]";
};

export type Phase1Config = {
  discordBotToken: string;
  discordClientId: string;
  guildId: string;
  dataDir: string;
  dbPath: string;
  dbBusyTimeoutMs: number;
  silenceMs: number;
  softRolloverMs: number;
  maxChunkMs: number;
  sttSafeFormat: SttSafeFormat;
  sttMaxAttempts: number;
  sttLeaseMs: number;
  partRepairAgeMs: number;
  enableDave: boolean;
  decryptionFailureTolerance: number;
  debugVoice: boolean;
  autoRegisterCommands: boolean;
  dashboardHost: "127.0.0.1";
  dashboardPort: number;
  openDashboard: boolean;
};

export type Phase3SttProviderName = SttProviderName;

export type Phase3SttConfig = {
  openAiApiKey: string;
  provider: Phase3SttProviderName;
  openAiModel: string;
  language: string;
  timeoutMs: number;
  localWhisperCommand: string;
  localWhisperArgs: string[];
  localWhisperModel: string;
  localWhisperDevice: string;
  localWhisperComputeType: string;
};

export type Phase1ConfigSnapshot = Omit<Phase1Config, "discordBotToken"> & {
  discordBotToken: "[REDACTED]" | "[MISSING]";
};

export function loadDotEnv(): void {
  dotenv.config({ path: path.resolve(process.cwd(), ".env"), quiet: true });
}

export function loadPhase0Config(options?: {
  requireDiscordConfig?: boolean;
}): Phase0Config {
  loadDotEnv();

  const missingKeys: string[] = [];
  const required = (key: string): string => {
    const value = process.env[key]?.trim();
    if (!value) {
      missingKeys.push(key);
      return "";
    }
    return value;
  };

  const optional = (key: string, fallback: string): string =>
    process.env[key]?.trim() || fallback;

  const sttSafeFormat = optional("PHASE0_STT_SAFE_FORMAT", "webm");
  if (sttSafeFormat !== "webm" && sttSafeFormat !== "wav") {
    throw new Error(
      "PHASE0_STT_SAFE_FORMAT은 webm 또는 wav 중 하나여야 합니다.",
    );
  }

  const config: Phase0Config = {
    discordBotToken: options?.requireDiscordConfig
      ? required("DISCORD_BOT_TOKEN")
      : process.env.DISCORD_BOT_TOKEN?.trim() ?? "",
    discordClientId: options?.requireDiscordConfig
      ? required("DISCORD_CLIENT_ID")
      : process.env.DISCORD_CLIENT_ID?.trim() ?? "",
    guildId: options?.requireDiscordConfig
      ? required("DISCORD_GUILD_ID")
      : process.env.DISCORD_GUILD_ID?.trim() ?? "",
    voiceChannelId: options?.requireDiscordConfig
      ? required("DISCORD_VOICE_CHANNEL_ID")
      : process.env.DISCORD_VOICE_CHANNEL_ID?.trim() ?? "",
    dataDir: path.resolve(optional("PHASE0_DATA_DIR", "./data/phase0")),
    silenceMs: readNumber("PHASE0_SILENCE_MS", 1000),
    maxChunkMs: readNumber("PHASE0_MAX_CHUNK_MS", 120000),
    sttSafeFormat,
    enableDave: readBoolean("PHASE0_ENABLE_DAVE", true),
    decryptionFailureTolerance: readNumber(
      "PHASE0_DECRYPTION_FAILURE_TOLERANCE",
      24,
    ),
    debugVoice: readBoolean("PHASE0_DEBUG_VOICE", true),
    autoRegisterCommands: readBoolean("PHASE0_AUTO_REGISTER_COMMANDS", true),
  };

  if (missingKeys.length > 0) {
    throw new MissingRequiredConfigError(missingKeys);
  }

  return config;
}

export function snapshotConfig(config: Phase0Config): Phase0ConfigSnapshot {
  return {
    ...config,
    discordBotToken: config.discordBotToken ? "[REDACTED]" : "[MISSING]",
  };
}

export function loadPhase1Config(options?: {
  requireDiscordConfig?: boolean;
}): Phase1Config {
  loadDotEnv();

  const missingKeys: string[] = [];
  const required = (key: string): string => {
    const value = process.env[key]?.trim();
    if (!value) {
      missingKeys.push(key);
      return "";
    }
    return value;
  };

  const optional = (key: string, fallback: string): string =>
    process.env[key]?.trim() || fallback;

  const sttSafeFormat = optional("PHASE1_STT_SAFE_FORMAT", "webm");
  if (sttSafeFormat !== "webm" && sttSafeFormat !== "wav") {
    throw new Error(
      "PHASE1_STT_SAFE_FORMAT은 webm 또는 wav 중 하나여야 합니다.",
    );
  }

  const dataDir = path.resolve(optional("PHASE1_DATA_DIR", "./data/sessions"));
  const dashboardHost = optional("PHASE1_DASHBOARD_HOST", "127.0.0.1");
  if (dashboardHost !== "127.0.0.1") {
    throw new Error("Dirong dashboard는 127.0.0.1에만 bind할 수 있습니다.");
  }

  const config: Phase1Config = {
    discordBotToken: options?.requireDiscordConfig
      ? required("DISCORD_BOT_TOKEN")
      : process.env.DISCORD_BOT_TOKEN?.trim() ?? "",
    discordClientId: options?.requireDiscordConfig
      ? required("DISCORD_CLIENT_ID")
      : process.env.DISCORD_CLIENT_ID?.trim() ?? "",
    guildId: options?.requireDiscordConfig
      ? required("DISCORD_GUILD_ID")
      : process.env.DISCORD_GUILD_ID?.trim() ?? "",
    dataDir,
    dbPath: path.resolve(
      optional("PHASE1_DB_PATH", path.join(dataDir, "dirong.sqlite")),
    ),
    dbBusyTimeoutMs: readNumber("PHASE1_DB_BUSY_TIMEOUT_MS", 5000),
    silenceMs: readNumber("PHASE1_SILENCE_MS", 1000),
    softRolloverMs: readNumber("PHASE1_SOFT_ROLLOVER_MS", 60000),
    maxChunkMs: readNumber("PHASE1_MAX_CHUNK_MS", 120000),
    sttSafeFormat,
    sttMaxAttempts: readNumber("PHASE1_STT_MAX_ATTEMPTS", 3),
    sttLeaseMs: readNumber("PHASE1_STT_LEASE_MS", 900000),
    partRepairAgeMs: readNumber("PHASE1_PART_REPAIR_AGE_MS", 300000),
    enableDave: readBoolean("PHASE1_ENABLE_DAVE", true),
    decryptionFailureTolerance: readNumber(
      "PHASE1_DECRYPTION_FAILURE_TOLERANCE",
      24,
    ),
    debugVoice: readBoolean("PHASE1_DEBUG_VOICE", true),
    autoRegisterCommands: readBoolean("PHASE1_AUTO_REGISTER_COMMANDS", true),
    dashboardHost,
    dashboardPort: readNumber("PHASE1_DASHBOARD_PORT", 3095),
    openDashboard: readBoolean("PHASE1_OPEN_DASHBOARD", true),
  };

  if (config.dashboardPort <= 0 || config.dashboardPort > 65535) {
    throw new Error("PHASE1_DASHBOARD_PORT는 1부터 65535 사이여야 합니다.");
  }

  if (config.softRolloverMs > config.maxChunkMs) {
    throw new Error("PHASE1_SOFT_ROLLOVER_MS는 PHASE1_MAX_CHUNK_MS보다 작거나 같아야 합니다.");
  }

  if (missingKeys.length > 0) {
    throw new MissingRequiredConfigError(missingKeys);
  }

  return config;
}

export function snapshotPhase1Config(config: Phase1Config): Phase1ConfigSnapshot {
  return {
    ...config,
    discordBotToken: config.discordBotToken ? "[REDACTED]" : "[MISSING]",
  };
}

export function loadPhase3SttConfig(): Phase3SttConfig {
  loadDotEnv();
  const sttSettings = loadSttSettingsFromEnv(process.env);
  const openAiSettings = resolveOpenAiSettings(sttSettings);
  const localWhisperSettings = resolveLocalWhisperSettings(sttSettings);

  return {
    openAiApiKey: openAiSettings.apiKey,
    provider: sttSettings.provider,
    openAiModel: openAiSettings.model,
    language: sttSettings.language,
    timeoutMs: sttSettings.timeoutMs,
    localWhisperCommand: localWhisperSettings.command,
    localWhisperArgs: localWhisperSettings.args,
    localWhisperModel: localWhisperSettings.model,
    localWhisperDevice: localWhisperSettings.device,
    localWhisperComputeType: localWhisperSettings.computeType,
  };
}

function readBoolean(key: string, fallback: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (!raw) {
    return fallback;
  }
  return ["1", "true", "yes", "y", "on"].includes(raw);
}

function readNumber(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${key} 값은 0 이상의 숫자여야 합니다.`);
  }

  return parsed;
}

function resolveOpenAiSettings(settings: SttSettings): {
  apiKey: string;
  model: string;
} {
  return settings.provider === "openai"
    ? settings.openai
    : {
        apiKey: process.env.OPENAI_API_KEY?.trim() ?? "",
        model: process.env.PHASE3_STT_MODEL?.trim() || "gpt-4o-mini-transcribe",
      };
}

function resolveLocalWhisperSettings(settings: SttSettings): {
  command: string;
  args: string[];
  model: string;
  device: string;
  computeType: string;
} {
  return settings.provider === "local-whisper"
    ? settings.localWhisper
    : {
        command: process.env.PHASE3_LOCAL_WHISPER_COMMAND?.trim() || "python",
        args: ["scripts/local-whisper-json.py"],
        model: process.env.PHASE3_LOCAL_WHISPER_MODEL?.trim() || "small",
        device: process.env.PHASE3_LOCAL_WHISPER_DEVICE?.trim() || "cpu",
        computeType: process.env.PHASE3_LOCAL_WHISPER_COMPUTE_TYPE?.trim() || "int8",
      };
}
