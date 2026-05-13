import {
  LOCAL_ONLY_DASHBOARD_HOST,
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

export function snapshotPhase1Config(config: Phase1Config): Phase1ConfigSnapshot {
  return {
    ...config,
    discordBotToken: config.discordBotToken ? "[REDACTED]" : "[MISSING]",
  };
}
