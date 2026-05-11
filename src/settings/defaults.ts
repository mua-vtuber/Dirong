import type {
  AiCleanupRuntimeSettings,
  SttProviderName,
} from "./app-settings.js";
import {
  DEFAULT_NOTION_API_VERSION,
  DEFAULT_NOTION_BASE_URL,
  DEFAULT_NOTION_PROPERTY_NAMES,
  DEFAULT_NOTION_REQUEST_TIMEOUT_MS,
  type NotionRuntimeSettings,
} from "../notion/settings.js";
import {
  DEFAULT_CLAUDE_TOOL_PROFILE,
  DEFAULT_LOCAL_WHISPER_TOOL_PROFILE,
} from "./tool-profiles.js";

export const DIRONG_LOCALES = ["ko", "en"] as const;
export type DirongLocale = (typeof DIRONG_LOCALES)[number];

export const DIRONG_DASHBOARD_THEMES = ["system", "light", "dark"] as const;
export type DirongDashboardTheme = (typeof DIRONG_DASHBOARD_THEMES)[number];

export const LOCAL_ONLY_DASHBOARD_HOST = "127.0.0.1" as const;
export const SUPPORTED_STT_SAFE_FORMATS = ["webm", "wav"] as const;
export type SttSafeFormat = (typeof SUPPORTED_STT_SAFE_FORMATS)[number];

export const DEFAULT_MEETING_NOTES_LANGUAGE: DirongLocale = "ko";
export const CREATABLE_NOTION_SCHEMA_LOCALES = ["ko"] as const;
export type CreatableNotionSchemaLocale =
  (typeof CREATABLE_NOTION_SCHEMA_LOCALES)[number];

export const DEFAULT_RECORDING_SETTINGS = {
  dataDir: "./data/sessions",
  dbBusyTimeoutMs: 5000,
  silenceMs: 1000,
  softRolloverMs: 60000,
  maxChunkMs: 120000,
  sttSafeFormat: "webm" satisfies SttSafeFormat,
  sttMaxAttempts: 3,
  sttLeaseMs: 900000,
  partRepairAgeMs: 300000,
  enableDave: true,
  decryptionFailureTolerance: 24,
  envDebugVoice: true,
  productDebugVoice: false,
  envAutoRegisterCommands: true,
  envAloneFinalizeEnabled: false,
  productAloneFinalizeEnabled: true,
  aloneFinalizeGraceMs: 90000,
} as const;

export const DEFAULT_STT_SETTINGS = {
  provider: "local-whisper" satisfies SttProviderName,
  language: DEFAULT_MEETING_NOTES_LANGUAGE,
  timeoutMs: 120000,
  openai: {
    apiKey: "",
    model: "gpt-4o-mini-transcribe",
  },
  localWhisper: {
    profile: DEFAULT_LOCAL_WHISPER_TOOL_PROFILE,
    command: "python",
    args: ["scripts/local-whisper-json.py"],
    model: "small",
    device: "cpu",
    computeType: "int8",
  },
} as const;

export const DEFAULT_AI_CLEANUP_SETTINGS = {
  claudeCommand: "claude",
  claudeModel: null,
  prepareTimeoutMs: 5000,
  autoCleanupEnabled: true,
  autoCleanupPollMs: 5000,
  autoCleanupSessionBatchLimit: 3,
  readinessRetryMs: 60000,
  leaseMs: null,
  maxAttempts: 3,
  maxInputChars: 120000,
  timeoutMs: 120000,
  maxOutputBytes: 2 * 1024 * 1024,
} satisfies AiCleanupRuntimeSettings;

export const DEFAULT_NOTION_SETTINGS = {
  enabled: false,
  apiKey: null,
  apiVersion: DEFAULT_NOTION_API_VERSION,
  baseUrl: DEFAULT_NOTION_BASE_URL,
  requestTimeoutMs: DEFAULT_NOTION_REQUEST_TIMEOUT_MS,
  targetUrl: null,
  targetType: "data_source",
  uploadMode: "manual",
  templateType: "app",
  includeTranscript: "never",
  autoPollMs: 5000,
  leaseMs: 600000,
  maxAttempts: 3,
  propertyNames: { ...DEFAULT_NOTION_PROPERTY_NAMES },
} satisfies NotionRuntimeSettings;

export const DEFAULT_RETENTION_SETTINGS = {
  deleteAudioAfterNotionUpload: true,
  textDraftRetentionDays: 30,
} as const;

export const DEFAULT_DASHBOARD_SETTINGS = {
  locale: DEFAULT_MEETING_NOTES_LANGUAGE,
  theme: "system" satisfies DirongDashboardTheme,
  themes: DIRONG_DASHBOARD_THEMES,
  host: LOCAL_ONLY_DASHBOARD_HOST,
  port: 3095,
  openDashboard: true,
} as const;

export const DEFAULT_SETUP_AI_SETTINGS = {
  provider: "claude",
  mode: "cli",
  claudeProfile: DEFAULT_CLAUDE_TOOL_PROFILE,
  model: null,
} as const;
