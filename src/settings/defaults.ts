import type {
  AiCleanupRuntimeSettings,
  SttProviderName,
} from "./app-settings.js";
import type { AiProviderName } from "./ai-providers.js";
import {
  DEFAULT_NOTION_API_VERSION,
  DEFAULT_NOTION_BASE_URL,
  DEFAULT_NOTION_PROPERTY_NAMES,
  DEFAULT_NOTION_REQUEST_TIMEOUT_MS,
  type NotionRuntimeSettings,
} from "../notion/settings.js";
import {
  DEFAULT_AI_TOOL_PROFILES,
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
export const CREATABLE_NOTION_SCHEMA_LOCALES = ["ko", "en"] as const;
export type CreatableNotionSchemaLocale =
  (typeof CREATABLE_NOTION_SCHEMA_LOCALES)[number];
export const SUPPORTED_CLAUDE_SETUP_MODELS = ["haiku", "sonnet", "opus"] as const;
export type ClaudeSetupModel = (typeof SUPPORTED_CLAUDE_SETUP_MODELS)[number];
export const DEFAULT_SETUP_CLAUDE_MODEL: ClaudeSetupModel = "haiku";
export const DEFAULT_SETUP_AI_MODEL_BY_PROVIDER = {
  claude: DEFAULT_SETUP_CLAUDE_MODEL,
  codex: "default",
  gemini: "default",
} as const satisfies Record<AiProviderName, string>;

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
  productDebugVoice: false,
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
  provider: "claude",
  mode: "cli",
  command: "claude",
  model: null,
  apiKey: null,
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
  uploadMode: "automatic_after_ai_cleanup",
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

// STT timeoutMs 허용 범위. 백엔드 저장 검증 + 대시보드 입력 min/max 공용.
// readPositiveInteger가 양의 정수만 통과시키므로 0/음수/소수는 이미 거부되며,
// 아래 상한/하한은 비정상값(예: 1ms, 무한대 timeout) 저장을 막는다.
export const STT_TIMEOUT_MS_MIN = 5000;
export const STT_TIMEOUT_MS_MAX = 600000;

// 자동 retention sweep 폴링 간격. 만료 cutoff는 일 단위라 분 단위 정밀도가 불필요.
// 6시간이면 하루 4회 점검으로 충분히 적시 + SQLite 조회 부하 최소.
export const RETENTION_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
// textDraftRetentionDays 허용 범위. 저장 검증 + 대시보드 입력 min/max 공용.
export const RETENTION_DAYS_MIN = 1;
export const RETENTION_DAYS_MAX = 365;

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
  cliProfile: DEFAULT_CLAUDE_TOOL_PROFILE,
  claudeProfile: DEFAULT_CLAUDE_TOOL_PROFILE,
  providerProfiles: { ...DEFAULT_AI_TOOL_PROFILES },
  model: DEFAULT_SETUP_CLAUDE_MODEL,
} as const;
