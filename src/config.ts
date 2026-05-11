import path from "node:path";
import dotenv from "dotenv";
import { MissingRequiredConfigError } from "./errors.js";
import {
  DEFAULT_DASHBOARD_SETTINGS,
  DEFAULT_RECORDING_SETTINGS,
  LOCAL_ONLY_DASHBOARD_HOST,
  SUPPORTED_STT_SAFE_FORMATS,
  type SttSafeFormat,
} from "./settings/defaults.js";

export type { SttSafeFormat } from "./settings/defaults.js";

export type Phase1Config = {
  discordBotToken: string;
  discordClientId: string;
  guildId: string;
  guildIds: string[];
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
  dashboardHost: typeof LOCAL_ONLY_DASHBOARD_HOST;
  dashboardPort: number;
  openDashboard: boolean;
  aloneFinalizeEnabled: boolean;
  aloneFinalizeGraceMs: number;
};

export type Phase1ConfigSnapshot = Omit<Phase1Config, "discordBotToken"> & {
  discordBotToken: "[REDACTED]" | "[MISSING]";
};

export function loadDotEnv(): void {
  dotenv.config({ path: path.resolve(process.cwd(), ".env"), quiet: true });
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
  const guildIds = readDiscordGuildIdsFromEnv();

  const sttSafeFormat = optional(
    "PHASE1_STT_SAFE_FORMAT",
    DEFAULT_RECORDING_SETTINGS.sttSafeFormat,
  );
  if (!isSttSafeFormat(sttSafeFormat)) {
    throw new Error(
      "PHASE1_STT_SAFE_FORMAT은 webm 또는 wav 중 하나여야 합니다.",
    );
  }

  const dataDir = path.resolve(
    optional("PHASE1_DATA_DIR", DEFAULT_RECORDING_SETTINGS.dataDir),
  );
  const dashboardHost = optional(
    "PHASE1_DASHBOARD_HOST",
    DEFAULT_DASHBOARD_SETTINGS.host,
  );
  if (dashboardHost !== LOCAL_ONLY_DASHBOARD_HOST) {
    throw new Error("Dirong dashboard는 127.0.0.1에만 bind할 수 있습니다.");
  }

  const config: Phase1Config = {
    discordBotToken: options?.requireDiscordConfig
      ? required("DISCORD_BOT_TOKEN")
      : process.env.DISCORD_BOT_TOKEN?.trim() ?? "",
    discordClientId: options?.requireDiscordConfig
      ? required("DISCORD_CLIENT_ID")
      : process.env.DISCORD_CLIENT_ID?.trim() ?? "",
    guildId: guildIds[0] ?? "",
    guildIds,
    dataDir,
    dbPath: path.resolve(
      optional("PHASE1_DB_PATH", path.join(dataDir, "dirong.sqlite")),
    ),
    dbBusyTimeoutMs: readNumber(
      "PHASE1_DB_BUSY_TIMEOUT_MS",
      DEFAULT_RECORDING_SETTINGS.dbBusyTimeoutMs,
    ),
    silenceMs: readNumber(
      "PHASE1_SILENCE_MS",
      DEFAULT_RECORDING_SETTINGS.silenceMs,
    ),
    softRolloverMs: readNumber(
      "PHASE1_SOFT_ROLLOVER_MS",
      DEFAULT_RECORDING_SETTINGS.softRolloverMs,
    ),
    maxChunkMs: readNumber(
      "PHASE1_MAX_CHUNK_MS",
      DEFAULT_RECORDING_SETTINGS.maxChunkMs,
    ),
    sttSafeFormat,
    sttMaxAttempts: readNumber(
      "PHASE1_STT_MAX_ATTEMPTS",
      DEFAULT_RECORDING_SETTINGS.sttMaxAttempts,
    ),
    sttLeaseMs: readNumber(
      "PHASE1_STT_LEASE_MS",
      DEFAULT_RECORDING_SETTINGS.sttLeaseMs,
    ),
    partRepairAgeMs: readNumber(
      "PHASE1_PART_REPAIR_AGE_MS",
      DEFAULT_RECORDING_SETTINGS.partRepairAgeMs,
    ),
    enableDave: readBoolean(
      "PHASE1_ENABLE_DAVE",
      DEFAULT_RECORDING_SETTINGS.enableDave,
    ),
    decryptionFailureTolerance: readNumber(
      "PHASE1_DECRYPTION_FAILURE_TOLERANCE",
      DEFAULT_RECORDING_SETTINGS.decryptionFailureTolerance,
    ),
    debugVoice: readBoolean(
      "PHASE1_DEBUG_VOICE",
      DEFAULT_RECORDING_SETTINGS.envDebugVoice,
    ),
    autoRegisterCommands: readBoolean(
      "PHASE1_AUTO_REGISTER_COMMANDS",
      DEFAULT_RECORDING_SETTINGS.envAutoRegisterCommands,
    ),
    dashboardHost,
    dashboardPort: readNumber(
      "PHASE1_DASHBOARD_PORT",
      DEFAULT_DASHBOARD_SETTINGS.port,
    ),
    openDashboard: readBoolean(
      "PHASE1_OPEN_DASHBOARD",
      DEFAULT_DASHBOARD_SETTINGS.openDashboard,
    ),
    aloneFinalizeEnabled: readBoolean(
      "DIRONG_ALONE_FINALIZE_ENABLED",
      DEFAULT_RECORDING_SETTINGS.envAloneFinalizeEnabled,
    ),
    aloneFinalizeGraceMs: readNumber(
      "DIRONG_ALONE_FINALIZE_GRACE_MS",
      DEFAULT_RECORDING_SETTINGS.aloneFinalizeGraceMs,
    ),
  };

  if (config.dashboardPort <= 0 || config.dashboardPort > 65535) {
    throw new Error("PHASE1_DASHBOARD_PORT는 1부터 65535 사이여야 합니다.");
  }

  if (config.aloneFinalizeGraceMs <= 0) {
    throw new Error("DIRONG_ALONE_FINALIZE_GRACE_MS는 1 이상의 숫자여야 합니다.");
  }

  if (options?.requireDiscordConfig && guildIds.length === 0) {
    missingKeys.push("DISCORD_GUILD_IDS or DISCORD_GUILD_ID");
  }

  if (config.softRolloverMs > config.maxChunkMs) {
    throw new Error("PHASE1_SOFT_ROLLOVER_MS는 PHASE1_MAX_CHUNK_MS보다 작거나 같아야 합니다.");
  }

  if (missingKeys.length > 0) {
    throw new MissingRequiredConfigError(missingKeys);
  }

  return config;
}

export function readDiscordGuildIdsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return uniqueStrings([
    ...splitDiscordGuildIds(env.DISCORD_GUILD_IDS),
    ...splitDiscordGuildIds(env.DISCORD_GUILD_ID),
  ]);
}

export function snapshotPhase1Config(config: Phase1Config): Phase1ConfigSnapshot {
  return {
    ...config,
    discordBotToken: config.discordBotToken ? "[REDACTED]" : "[MISSING]",
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

function splitDiscordGuildIds(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function isSttSafeFormat(value: string): value is SttSafeFormat {
  return SUPPORTED_STT_SAFE_FORMATS.includes(value as SttSafeFormat);
}
