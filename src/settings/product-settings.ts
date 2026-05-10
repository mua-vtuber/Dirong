import type { Phase1Config } from "../config.js";
import {
  DEFAULT_NOTION_API_VERSION,
  DEFAULT_NOTION_BASE_URL,
  DEFAULT_NOTION_PROPERTY_NAMES,
  type NotionRuntimeSettings,
} from "../notion/settings.js";
import type { NotionRegistryStore } from "../notion/registry-store.js";
import type { AppSettings, SttSettings } from "./app-settings.js";
import {
  getDirongUserDataPaths,
  resolveDirongUserDataPath,
  type DirongUserDataPaths,
} from "./dirong-user-data.js";
import {
  type AiLocalSettings,
  type DirongLocalSettings,
  LocalSettingsStore,
  type SttLocalSettings,
} from "./local-settings-store.js";
import {
  DEFAULT_SECRET_REFS,
  LocalSecretStore,
  type SecretPresenceSnapshot,
} from "./local-secret-store.js";

export type ProductFeatureStatus =
  | "not_configured"
  | "checking"
  | "ready"
  | "warning"
  | "blocked"
  | "repair_required";

export type ProductSetupFeatureSnapshot = {
  status: ProductFeatureStatus;
  message: string;
  userAction: string | null;
  missing: string[];
};

export type ProductSetupStatusSnapshot = {
  generatedAt: string;
  status: "not_configured" | "ready" | "blocked";
  userDataDir: string;
  settingsPath: string;
  secretsPath: string;
  databasePath: string;
  secrets: {
    discordBot: SecretPresenceSnapshot;
    openAi: SecretPresenceSnapshot;
    claude: SecretPresenceSnapshot;
    notion: SecretPresenceSnapshot;
  };
  features: {
    discord: ProductSetupFeatureSnapshot & {
      applicationIdConfigured: boolean;
      guildAllowlistCount: number;
    };
    recording: ProductSetupFeatureSnapshot;
    stt: ProductSetupFeatureSnapshot & {
      provider: string | null;
      model: string | null;
    };
    ai: ProductSetupFeatureSnapshot & {
      provider: string | null;
      mode: string | null;
    };
    notion: ProductSetupFeatureSnapshot & {
      parentPageConfigured: boolean;
      managedRegistryReady: boolean;
    };
    dataRetention: ProductSetupFeatureSnapshot & {
      deleteAudioAfterNotionUpload: boolean;
      textDraftRetentionDays: number;
    };
  };
};

export type ProductRuntimeSettings = {
  paths: DirongUserDataPaths;
  localSettings: DirongLocalSettings;
  config: Phase1Config;
  appSettings: AppSettings;
  setupStatus: ProductSetupStatusSource;
};

export type ProductRuntimeSettingsOptions = {
  userDataDir?: string;
};

export class ProductSetupStatusSource {
  constructor(
    private readonly paths: DirongUserDataPaths,
    private readonly settingsStore: LocalSettingsStore,
    private readonly secretStore: LocalSecretStore,
    private readonly registryStore?: NotionRegistryStore,
  ) {}

  getSnapshot(): ProductSetupStatusSnapshot {
    return buildProductSetupStatus({
      paths: this.paths,
      settings: this.settingsStore.read(),
      secretStore: this.secretStore,
      registryStore: this.registryStore,
    });
  }
}

export function loadProductRuntimeSettings(
  options: ProductRuntimeSettingsOptions = {},
): ProductRuntimeSettings {
  const paths = getDirongUserDataPaths(
    options.userDataDir ?? resolveDirongUserDataPath(),
  );
  const settingsStore = new LocalSettingsStore(paths.settingsFile);
  const secretStore = new LocalSecretStore(paths.secretsFile);
  const localSettings = settingsStore.read();

  return {
    paths,
    localSettings,
    config: buildProductPhase1Config(paths, localSettings, secretStore),
    appSettings: buildProductAppSettings(localSettings, secretStore),
    setupStatus: new ProductSetupStatusSource(paths, settingsStore, secretStore),
  };
}

export function createProductSetupStatusSource(input: {
  paths: DirongUserDataPaths;
  registryStore?: NotionRegistryStore;
}): ProductSetupStatusSource {
  return new ProductSetupStatusSource(
    input.paths,
    new LocalSettingsStore(input.paths.settingsFile),
    new LocalSecretStore(input.paths.secretsFile),
    input.registryStore,
  );
}

export function buildProductPhase1Config(
  paths: DirongUserDataPaths,
  settings: DirongLocalSettings,
  secretStore: LocalSecretStore,
): Phase1Config {
  const guildIds = settings.discord.guildIds ?? [];
  const aloneFinalizeGraceMs = settings.recording.aloneFinalizeGraceMs ?? 90000;

  return {
    discordBotToken: secretStore.get(
      settings.discord.botTokenSecretRef ?? DEFAULT_SECRET_REFS.discordBotToken,
    ) ?? "",
    discordClientId: settings.discord.applicationId ?? "",
    guildId: guildIds[0] ?? "",
    guildIds,
    dataDir: paths.sessionsDir,
    dbPath: paths.databasePath,
    dbBusyTimeoutMs: 5000,
    silenceMs: 1000,
    softRolloverMs: 60000,
    maxChunkMs: 120000,
    sttSafeFormat: "webm",
    sttMaxAttempts: 3,
    sttLeaseMs: 900000,
    partRepairAgeMs: 300000,
    enableDave: true,
    decryptionFailureTolerance: 24,
    debugVoice: false,
    autoRegisterCommands: guildIds.length > 0,
    dashboardHost: "127.0.0.1",
    dashboardPort: 3095,
    openDashboard: true,
    aloneFinalizeEnabled: settings.recording.aloneFinalizeEnabled ?? true,
    aloneFinalizeGraceMs,
  };
}

export function buildProductAppSettings(
  settings: DirongLocalSettings,
  secretStore: LocalSecretStore,
): AppSettings {
  return {
    stt: buildProductSttSettings(settings.stt, secretStore),
    aiCleanup: {
      claudeCommand: settings.ai.claudeCommand ?? "claude",
      claudeModel: settings.ai.model ?? null,
      prepareTimeoutMs: 5000,
      autoCleanupEnabled: isAiConfigured(settings.ai, secretStore),
      autoCleanupPollMs: 5000,
      autoCleanupSessionBatchLimit: 3,
      readinessRetryMs: 60000,
      leaseMs: null,
      maxAttempts: 3,
      maxInputChars: 120000,
      timeoutMs: 120000,
      maxOutputBytes: 2 * 1024 * 1024,
    },
    notion: buildProductNotionSettings(settings, secretStore),
  };
}

export function buildProductSetupStatus(input: {
  paths: DirongUserDataPaths;
  settings: DirongLocalSettings;
  secretStore: LocalSecretStore;
  registryStore?: NotionRegistryStore;
}): ProductSetupStatusSnapshot {
  const discordSecretRef =
    input.settings.discord.botTokenSecretRef ?? DEFAULT_SECRET_REFS.discordBotToken;
  const openAiSecretRef =
    input.settings.stt.openAiApiKeySecretRef ?? DEFAULT_SECRET_REFS.openAiApiKey;
  const claudeSecretRef =
    input.settings.ai.apiKeySecretRef ?? DEFAULT_SECRET_REFS.claudeApiKey;
  const notionSecretRef =
    input.settings.notion.tokenSecretRef ?? DEFAULT_SECRET_REFS.notionToken;

  const secrets = {
    discordBot: input.secretStore.snapshot(discordSecretRef),
    openAi: input.secretStore.snapshot(openAiSecretRef),
    claude: input.secretStore.snapshot(claudeSecretRef),
    notion: input.secretStore.snapshot(notionSecretRef),
  };

  const discord = buildDiscordStatus(input.settings, secrets.discordBot);
  const stt = buildSttStatus(input.settings, secrets.openAi);
  const ai = buildAiStatus(input.settings, secrets.claude);
  const notion = buildNotionStatus(input.settings, secrets.notion, input.registryStore);
  const recording = buildRecordingStatus(discord, stt);
  const dataRetention = buildDataRetentionStatus(input.settings);
  const featureStatuses = [
    discord.status,
    stt.status,
    ai.status,
    notion.status,
    recording.status,
    dataRetention.status,
  ];

  return {
    generatedAt: new Date().toISOString(),
    status: featureStatuses.every((status) => status === "ready")
      ? "ready"
      : featureStatuses.includes("not_configured")
        ? "not_configured"
        : featureStatuses.includes("blocked") ||
            featureStatuses.includes("repair_required")
          ? "blocked"
          : "not_configured",
    userDataDir: input.paths.root,
    settingsPath: input.paths.settingsFile,
    secretsPath: input.paths.secretsFile,
    databasePath: input.paths.databasePath,
    secrets,
    features: {
      discord,
      recording,
      stt,
      ai,
      notion,
      dataRetention,
    },
  };
}

export function canStartDiscordRuntime(
  status: ProductSetupStatusSnapshot,
): boolean {
  return status.features.discord.status === "ready";
}

export function canStartSttAutomation(
  status: ProductSetupStatusSnapshot,
): boolean {
  return status.features.stt.status === "ready";
}

export function canStartAiAutomation(
  status: ProductSetupStatusSnapshot,
): boolean {
  return status.features.ai.status === "ready";
}

export function canStartNotionAutomation(
  status: ProductSetupStatusSnapshot,
): boolean {
  return status.features.notion.status === "ready";
}

function buildProductSttSettings(
  settings: SttLocalSettings,
  secretStore: LocalSecretStore,
): SttSettings {
  const provider = settings.provider ?? "local-whisper";
  const language = settings.language ?? "ko";
  const timeoutMs = settings.timeoutMs ?? 120000;

  if (provider === "openai") {
    return {
      provider,
      language,
      timeoutMs,
      openai: {
        apiKey:
          secretStore.get(
            settings.openAiApiKeySecretRef ?? DEFAULT_SECRET_REFS.openAiApiKey,
          ) ?? "",
        model: settings.openAiModel ?? "gpt-4o-mini-transcribe",
      },
    };
  }

  return {
    provider: "local-whisper",
    language,
    timeoutMs,
    localWhisper: {
      command: settings.localWhisper?.command ?? "python",
      args: settings.localWhisper?.args ?? ["scripts/local-whisper-json.py"],
      model: settings.localWhisper?.model ?? "small",
      device: settings.localWhisper?.device ?? "cpu",
      computeType: settings.localWhisper?.computeType ?? "int8",
    },
  };
}

function buildProductNotionSettings(
  settings: DirongLocalSettings,
  secretStore: LocalSecretStore,
): NotionRuntimeSettings {
  const apiKey = secretStore.get(
    settings.notion.tokenSecretRef ?? DEFAULT_SECRET_REFS.notionToken,
  );
  const parentPageUrl = settings.notion.parentPageUrl;

  return {
    enabled: Boolean(apiKey && parentPageUrl),
    apiKey,
    apiVersion: DEFAULT_NOTION_API_VERSION,
    baseUrl: DEFAULT_NOTION_BASE_URL,
    targetUrl: null,
    targetType: "data_source",
    uploadMode: settings.notion.uploadMode ?? "manual",
    templateType: "app",
    includeTranscript: "never",
    autoPollMs: 5000,
    leaseMs: 600000,
    maxAttempts: 3,
    propertyNames: DEFAULT_NOTION_PROPERTY_NAMES,
  };
}

function isAiConfigured(
  settings: AiLocalSettings,
  secretStore: LocalSecretStore,
): boolean {
  if (settings.provider !== "claude" || !settings.mode) {
    return false;
  }
  if (settings.mode === "api") {
    return secretStore.has(settings.apiKeySecretRef ?? DEFAULT_SECRET_REFS.claudeApiKey);
  }
  return Boolean(settings.claudeCommand?.trim());
}

function buildDiscordStatus(
  settings: DirongLocalSettings,
  secret: SecretPresenceSnapshot,
): ProductSetupStatusSnapshot["features"]["discord"] {
  const missing = [
    settings.discord.applicationId ? null : "discord.applicationId",
    secret.configured ? null : "discord.botToken",
    (settings.discord.guildIds?.length ?? 0) > 0 ? null : "discord.guildAllowlist",
  ].filter((key): key is string => key !== null);

  if (missing.length > 0) {
    return {
      status: "not_configured",
      message: "Discord 봇 연결 설정이 아직 완료되지 않았습니다.",
      userAction: "설정에서 Discord application ID, bot token, 사용할 서버 선택을 완료해 주세요.",
      missing,
      applicationIdConfigured: Boolean(settings.discord.applicationId),
      guildAllowlistCount: settings.discord.guildIds?.length ?? 0,
    };
  }

  return {
    status: "ready",
    message: "Discord 필수 설정이 저장되어 있습니다.",
    userAction: null,
    missing: [],
    applicationIdConfigured: true,
    guildAllowlistCount: settings.discord.guildIds?.length ?? 0,
  };
}

function buildSttStatus(
  settings: DirongLocalSettings,
  openAiSecret: SecretPresenceSnapshot,
): ProductSetupStatusSnapshot["features"]["stt"] {
  if (!settings.stt.provider) {
    return {
      status: "not_configured",
      message: "STT provider와 모델 설정이 아직 저장되지 않았습니다.",
      userAction: "설정 위자드에서 local faster-whisper 또는 OpenAI STT를 선택해 주세요.",
      missing: ["stt.provider"],
      provider: null,
      model: null,
    };
  }

  if (settings.stt.provider === "openai" && !openAiSecret.configured) {
    return {
      status: "not_configured",
      message: "OpenAI STT API key가 아직 저장되지 않았습니다.",
      userAction: "OpenAI STT를 계속 쓰려면 API key를 다시 입력해 주세요.",
      missing: ["stt.openAiApiKey"],
      provider: "openai",
      model: settings.stt.openAiModel ?? null,
    };
  }

  return {
    status: "ready",
    message: "STT 기본 설정이 저장되어 있습니다.",
    userAction: null,
    missing: [],
    provider: settings.stt.provider,
    model:
      settings.stt.provider === "openai"
        ? settings.stt.openAiModel ?? "gpt-4o-mini-transcribe"
        : settings.stt.localWhisper?.model ?? "small",
  };
}

function buildAiStatus(
  settings: DirongLocalSettings,
  claudeSecret: SecretPresenceSnapshot,
): ProductSetupStatusSnapshot["features"]["ai"] {
  if (settings.ai.provider !== "claude" || !settings.ai.mode) {
    return {
      status: "not_configured",
      message: "AI 회의록 provider 설정이 아직 저장되지 않았습니다.",
      userAction: "설정 위자드에서 Claude CLI 또는 Claude API 사용 방식을 선택해 주세요.",
      missing: ["ai.provider", "ai.mode"],
      provider: settings.ai.provider ?? null,
      mode: settings.ai.mode ?? null,
    };
  }

  if (settings.ai.mode === "api" && !claudeSecret.configured) {
    return {
      status: "not_configured",
      message: "Claude API key가 아직 저장되지 않았습니다.",
      userAction: "Claude API key를 다시 입력하거나 Claude CLI 모드로 바꿔 주세요.",
      missing: ["ai.claudeApiKey"],
      provider: "claude",
      mode: "api",
    };
  }

  if (settings.ai.mode === "cli" && !settings.ai.claudeCommand) {
    return {
      status: "not_configured",
      message: "Claude CLI command가 아직 저장되지 않았습니다.",
      userAction: "Claude CLI 모드를 쓰려면 실행 command를 저장해 주세요.",
      missing: ["ai.claudeCommand"],
      provider: "claude",
      mode: "cli",
    };
  }

  return {
    status: "ready",
    message: "AI 회의록 provider 설정이 저장되어 있습니다.",
    userAction: null,
    missing: [],
    provider: "claude",
    mode: settings.ai.mode,
  };
}

function buildNotionStatus(
  settings: DirongLocalSettings,
  notionSecret: SecretPresenceSnapshot,
  registryStore: NotionRegistryStore | undefined,
): ProductSetupStatusSnapshot["features"]["notion"] {
  const parentPageConfigured = Boolean(settings.notion.parentPageUrl);
  const missing = [
    notionSecret.configured ? null : "notion.token",
    parentPageConfigured ? null : "notion.parentPageUrl",
  ].filter((key): key is string => key !== null);

  if (missing.length > 0) {
    return {
      status: "not_configured",
      message: "Notion 연결 설정이 아직 완료되지 않았습니다.",
      userAction: "Notion internal connection token과 parent page URL을 저장해 주세요.",
      missing,
      parentPageConfigured,
      managedRegistryReady: false,
    };
  }

  const managedRegistryReady = Boolean(
    registryStore &&
      registryStore.listManagedDatabases().length === 3 &&
      registryStore.listPropertyMappings().length > 0,
  );

  if (!managedRegistryReady) {
    return {
      status: "blocked",
      message: "Notion 연결 값은 있지만 managed DB registry가 아직 없습니다.",
      userAction: "후속 Phase에서 managed DB 생성을 완료해야 Notion 업로드를 사용할 수 있습니다.",
      missing: ["notion.managedRegistry"],
      parentPageConfigured,
      managedRegistryReady: false,
    };
  }

  return {
    status: "ready",
    message: "Notion managed DB registry가 준비되어 있습니다.",
    userAction: null,
    missing: [],
    parentPageConfigured,
    managedRegistryReady: true,
  };
}

function buildRecordingStatus(
  discord: ProductSetupFeatureSnapshot,
  stt: ProductSetupFeatureSnapshot,
): ProductSetupFeatureSnapshot {
  if (discord.status !== "ready" || stt.status !== "ready") {
    return {
      status: "blocked",
      message: "녹음 시작은 Discord와 STT 설정이 끝난 뒤 사용할 수 있습니다.",
      userAction: "Discord 봇 연결과 STT provider 설정을 먼저 완료해 주세요.",
      missing: [
        ...(discord.status === "ready" ? [] : ["discord"]),
        ...(stt.status === "ready" ? [] : ["stt"]),
      ],
    };
  }

  return {
    status: "ready",
    message: "녹음 시작에 필요한 기본 설정이 준비되어 있습니다.",
    userAction: null,
    missing: [],
  };
}

function buildDataRetentionStatus(
  settings: DirongLocalSettings,
): ProductSetupStatusSnapshot["features"]["dataRetention"] {
  return {
    status: "ready",
    message: "기본 보관 정책이 적용되어 있습니다.",
    userAction: null,
    missing: [],
    deleteAudioAfterNotionUpload:
      settings.retention.deleteAudioAfterNotionUpload ?? true,
    textDraftRetentionDays: settings.retention.textDraftRetentionDays ?? 30,
  };
}
