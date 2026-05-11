import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { NotionUploadMode } from "../notion/settings.js";
import type { SttProviderName } from "./app-settings.js";
import {
  DEFAULT_DASHBOARD_SETTINGS,
  DEFAULT_RECORDING_SETTINGS,
  DEFAULT_RETENTION_SETTINGS,
  DIRONG_DASHBOARD_THEMES,
  DIRONG_LOCALES,
  type DirongDashboardTheme,
  type DirongLocale,
} from "./defaults.js";
import {
  isClaudeToolProfile,
  isLocalWhisperToolProfile,
  type ClaudeToolProfile,
  type LocalWhisperToolProfile,
} from "./tool-profiles.js";

export { DIRONG_DASHBOARD_THEMES, DIRONG_LOCALES };
export type { DirongDashboardTheme, DirongLocale };
export const DEFAULT_DIRONG_LOCALE: DirongLocale =
  DEFAULT_DASHBOARD_SETTINGS.locale;
export const DEFAULT_DIRONG_DASHBOARD_THEME: DirongDashboardTheme =
  DEFAULT_DASHBOARD_SETTINGS.theme;
export type AiProviderName = "claude";
export type AiProviderMode = "cli" | "api";

export type LocalWhisperLocalSettings = {
  profile?: LocalWhisperToolProfile;
  command?: string;
  args?: string[];
  model?: string;
  device?: string;
  computeType?: string;
};

export type SttLocalSettings = {
  provider?: SttProviderName;
  language?: string;
  timeoutMs?: number;
  localWhisper?: LocalWhisperLocalSettings;
  openAiApiKeySecretRef?: string;
  openAiModel?: string;
};

export type AiLocalSettings = {
  provider?: AiProviderName;
  mode?: AiProviderMode;
  model?: string;
  claudeProfile?: ClaudeToolProfile;
  claudeCommand?: string;
  apiKeySecretRef?: string;
};

export type DirongLocalSettings = {
  schemaVersion: 1;
  app: {
    locale?: DirongLocale;
    dashboardTheme?: DirongDashboardTheme;
  };
  discord: {
    applicationId?: string;
    botTokenSecretRef?: string;
    guildIds?: string[];
  };
  stt: SttLocalSettings;
  ai: AiLocalSettings;
  notion: {
    tokenSecretRef?: string;
    parentPageUrl?: string;
    uploadMode?: NotionUploadMode;
  };
  recording: {
    aloneFinalizeEnabled?: boolean;
    aloneFinalizeGraceMs?: number;
  };
  retention: {
    deleteAudioAfterNotionUpload?: boolean;
    textDraftRetentionDays?: number;
  };
};

export const DEFAULT_LOCAL_SETTINGS: DirongLocalSettings = {
  schemaVersion: 1,
  app: {
    locale: DEFAULT_DIRONG_LOCALE,
    dashboardTheme: DEFAULT_DIRONG_DASHBOARD_THEME,
  },
  discord: {},
  stt: {},
  ai: {},
  notion: {},
  recording: {
    aloneFinalizeEnabled: DEFAULT_RECORDING_SETTINGS.productAloneFinalizeEnabled,
    aloneFinalizeGraceMs: DEFAULT_RECORDING_SETTINGS.aloneFinalizeGraceMs,
  },
  retention: {
    deleteAudioAfterNotionUpload:
      DEFAULT_RETENTION_SETTINGS.deleteAudioAfterNotionUpload,
    textDraftRetentionDays: DEFAULT_RETENTION_SETTINGS.textDraftRetentionDays,
  },
};

export class LocalSettingsStore {
  constructor(readonly filePath: string) {}

  read(): DirongLocalSettings {
    if (!existsSync(this.filePath)) {
      return cloneDefaultSettings();
    }

    const raw = JSON.parse(readFileSync(this.filePath, "utf8")) as unknown;
    return normalizeLocalSettings(raw);
  }

  write(settings: DirongLocalSettings): void {
    const normalized = normalizeLocalSettings(settings);
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmpPath, `${JSON.stringify(normalized, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(tmpPath, this.filePath);
  }

  update(
    updater: (settings: DirongLocalSettings) => DirongLocalSettings,
  ): DirongLocalSettings {
    const next = updater(this.read());
    this.write(next);
    return this.read();
  }
}

export function normalizeLocalSettings(value: unknown): DirongLocalSettings {
  const record = isRecord(value) ? value : {};
  const defaults = cloneDefaultSettings();
  const app = isRecord(record.app) ? record.app : {};
  const discord = isRecord(record.discord) ? record.discord : {};
  const stt = isRecord(record.stt) ? record.stt : {};
  const ai = isRecord(record.ai) ? record.ai : {};
  const notion = isRecord(record.notion) ? record.notion : {};
  const recording = isRecord(record.recording) ? record.recording : {};
  const retention = isRecord(record.retention) ? record.retention : {};

  return {
    schemaVersion: 1,
    app: {
      locale: readLocale(app.locale) ?? defaults.app.locale,
      dashboardTheme:
        readDashboardTheme(app.dashboardTheme) ?? defaults.app.dashboardTheme,
    },
    discord: {
      applicationId: readString(discord.applicationId),
      botTokenSecretRef: readString(discord.botTokenSecretRef),
      guildIds: readStringArray(discord.guildIds),
    },
    stt: {
      provider: readSttProvider(stt.provider),
      language: readString(stt.language),
      timeoutMs: readPositiveInteger(stt.timeoutMs),
      localWhisper: normalizeLocalWhisperSettings(stt.localWhisper),
      openAiApiKeySecretRef: readString(stt.openAiApiKeySecretRef),
      openAiModel: readString(stt.openAiModel),
    },
    ai: {
      provider: readAiProvider(ai.provider),
      mode: readAiMode(ai.mode),
      model: readString(ai.model),
      claudeProfile: isClaudeToolProfile(ai.claudeProfile)
        ? ai.claudeProfile
        : undefined,
      claudeCommand: readString(ai.claudeCommand),
      apiKeySecretRef: readString(ai.apiKeySecretRef),
    },
    notion: {
      tokenSecretRef: readString(notion.tokenSecretRef),
      parentPageUrl: readString(notion.parentPageUrl),
      uploadMode: readNotionUploadMode(notion.uploadMode),
    },
    recording: {
      aloneFinalizeEnabled:
        typeof recording.aloneFinalizeEnabled === "boolean"
          ? recording.aloneFinalizeEnabled
          : defaults.recording.aloneFinalizeEnabled,
      aloneFinalizeGraceMs:
        readPositiveInteger(recording.aloneFinalizeGraceMs) ??
        defaults.recording.aloneFinalizeGraceMs,
    },
    retention: {
      deleteAudioAfterNotionUpload:
        typeof retention.deleteAudioAfterNotionUpload === "boolean"
          ? retention.deleteAudioAfterNotionUpload
          : defaults.retention.deleteAudioAfterNotionUpload,
      textDraftRetentionDays:
        readPositiveInteger(retention.textDraftRetentionDays) ??
        defaults.retention.textDraftRetentionDays,
    },
  };
}

function normalizeLocalWhisperSettings(value: unknown): LocalWhisperLocalSettings {
  if (!isRecord(value)) {
    return {};
  }
  return {
    profile: isLocalWhisperToolProfile(value.profile)
      ? value.profile
      : undefined,
    command: readString(value.command),
    args: readStringArray(value.args),
    model: readString(value.model),
    device: readString(value.device),
    computeType: readString(value.computeType),
  };
}

function cloneDefaultSettings(): DirongLocalSettings {
  return JSON.parse(JSON.stringify(DEFAULT_LOCAL_SETTINGS)) as DirongLocalSettings;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const entries = value
    .map((entry) => readString(entry))
    .filter((entry): entry is string => Boolean(entry));
  return entries.length > 0 ? [...new Set(entries)] : undefined;
}

function readPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const integer = Math.trunc(value);
  return integer > 0 ? integer : undefined;
}

function readLocale(value: unknown): DirongLocale | undefined {
  return isDirongLocale(value) ? value : undefined;
}

export function isDirongLocale(value: unknown): value is DirongLocale {
  return DIRONG_LOCALES.includes(value as DirongLocale);
}

export function isDirongDashboardTheme(
  value: unknown,
): value is DirongDashboardTheme {
  return DIRONG_DASHBOARD_THEMES.includes(value as DirongDashboardTheme);
}

function readDashboardTheme(value: unknown): DirongDashboardTheme | undefined {
  return isDirongDashboardTheme(value) ? value : undefined;
}

function readSttProvider(value: unknown): SttProviderName | undefined {
  return value === "local-whisper" || value === "openai" ? value : undefined;
}

function readAiProvider(value: unknown): AiProviderName | undefined {
  return value === "claude" ? value : undefined;
}

function readAiMode(value: unknown): AiProviderMode | undefined {
  return value === "cli" || value === "api" ? value : undefined;
}

function readNotionUploadMode(value: unknown): NotionUploadMode | undefined {
  return value === "manual" || value === "automatic_after_ai_cleanup"
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
