import type { Phase1Config } from "../config.js";
import { t, type LocaleKey } from "../i18n/catalog.js";
import {
  buildHumanStatusDisplay,
  type HumanStatusDisplay,
  type HumanStatusDisplayInput,
} from "../messages/human-status.js";
import {
  type NotionRuntimeSettings,
} from "../notion/settings.js";
import {
  readManagedNotionRegistrySnapshot,
  type ManagedNotionRegistrySnapshot,
  type ManagedNotionRegistryStatus,
} from "../notion/managed-registry.js";
import type { NotionRegistryStore } from "../notion/registry-store.js";
import type { AppSettings, SttSettings } from "./app-settings.js";
import {
  getDirongUserDataPaths,
  resolveDirongUserDataPath,
  type DirongUserDataPaths,
} from "./dirong-user-data.js";
import {
  type AiLocalSettings,
  DEFAULT_DIRONG_DASHBOARD_THEME,
  DEFAULT_DIRONG_LOCALE,
  type DirongDashboardTheme,
  type DirongLocale,
  type DirongLocalSettings,
  LocalSettingsStore,
  type SttLocalSettings,
} from "./local-settings-store.js";
import {
  DEFAULT_AI_CLEANUP_SETTINGS,
  DEFAULT_DASHBOARD_SETTINGS,
  DEFAULT_NOTION_SETTINGS,
  DEFAULT_RECORDING_SETTINGS,
  DEFAULT_RETENTION_SETTINGS,
  DEFAULT_SETUP_AI_SETTINGS,
  DEFAULT_STT_SETTINGS,
} from "./defaults.js";
import {
  DEFAULT_SECRET_REFS,
  LocalSecretStore,
  type SecretPresenceSnapshot,
} from "./local-secret-store.js";
import {
  DEFAULT_CLAUDE_TOOL_PROFILE,
  DEFAULT_LOCAL_WHISPER_TOOL_PROFILE,
  resolveClaudeToolProfile,
  resolveLocalWhisperToolProfile,
} from "./tool-profiles.js";

export type ProductFeatureStatus =
  | "not_configured"
  | "checking"
  | "ready"
  | "warning"
  | "blocked"
  | "repair_required";

export type ProductSetupFeatureSnapshot = {
  status: ProductFeatureStatus;
  messageKey: LocaleKey;
  message: string;
  userActionKey: LocaleKey | null;
  userAction: string | null;
  display?: HumanStatusDisplay;
  missing: string[];
};

export type ProductSetupStatusSnapshot = {
  generatedAt: string;
  locale: DirongLocale;
  notionSchemaLocale: DirongLocale;
  dashboardTheme: DirongDashboardTheme;
  defaults: ProductSetupDefaultsSnapshot;
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
      managedRegistryStatus?: ManagedNotionRegistryStatus;
      managedRegistry?: ManagedNotionRegistrySnapshot;
    };
    dataRetention: ProductSetupFeatureSnapshot & {
      deleteAudioAfterNotionUpload: boolean;
      textDraftRetentionDays: number;
    };
  };
};

export type ProductSetupDefaultsSnapshot = {
  stt: {
    provider: typeof DEFAULT_STT_SETTINGS.provider;
    language: string;
    timeoutMs: number;
    openAiModel: string;
    localWhisper: {
      profile: typeof DEFAULT_LOCAL_WHISPER_TOOL_PROFILE;
      model: string;
      device: string;
      computeType: string;
    };
  };
  ai: typeof DEFAULT_SETUP_AI_SETTINGS;
  retention: typeof DEFAULT_RETENTION_SETTINGS;
  dashboard: {
    locale: DirongLocale;
    theme: DirongDashboardTheme;
    themes: readonly DirongDashboardTheme[];
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

  getLocale(): DirongLocale {
    return this.settingsStore.read().app.locale ?? DEFAULT_DIRONG_LOCALE;
  }

  getTheme(): DirongDashboardTheme {
    return (
      this.settingsStore.read().app.dashboardTheme ??
      DEFAULT_DIRONG_DASHBOARD_THEME
    );
  }

  setLocale(locale: DirongLocale): ProductSetupStatusSnapshot {
    this.settingsStore.update((settings) => ({
      ...settings,
      app: {
        ...settings.app,
        locale,
      },
    }));
    return this.getSnapshot();
  }

  setTheme(theme: DirongDashboardTheme): ProductSetupStatusSnapshot {
    this.settingsStore.update((settings) => ({
      ...settings,
      app: {
        ...settings.app,
        dashboardTheme: theme,
      },
    }));
    return this.getSnapshot();
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
  const aloneFinalizeGraceMs =
    settings.recording.aloneFinalizeGraceMs ??
    DEFAULT_RECORDING_SETTINGS.aloneFinalizeGraceMs;

  return {
    discordBotToken: secretStore.get(
      settings.discord.botTokenSecretRef ?? DEFAULT_SECRET_REFS.discordBotToken,
    ) ?? "",
    discordClientId: settings.discord.applicationId ?? "",
    guildId: guildIds[0] ?? "",
    guildIds,
    dataDir: paths.sessionsDir,
    dbPath: paths.databasePath,
    dbBusyTimeoutMs: DEFAULT_RECORDING_SETTINGS.dbBusyTimeoutMs,
    silenceMs: DEFAULT_RECORDING_SETTINGS.silenceMs,
    softRolloverMs: DEFAULT_RECORDING_SETTINGS.softRolloverMs,
    maxChunkMs: DEFAULT_RECORDING_SETTINGS.maxChunkMs,
    sttSafeFormat: DEFAULT_RECORDING_SETTINGS.sttSafeFormat,
    sttMaxAttempts: DEFAULT_RECORDING_SETTINGS.sttMaxAttempts,
    sttLeaseMs: DEFAULT_RECORDING_SETTINGS.sttLeaseMs,
    partRepairAgeMs: DEFAULT_RECORDING_SETTINGS.partRepairAgeMs,
    enableDave: DEFAULT_RECORDING_SETTINGS.enableDave,
    decryptionFailureTolerance:
      DEFAULT_RECORDING_SETTINGS.decryptionFailureTolerance,
    debugVoice: DEFAULT_RECORDING_SETTINGS.productDebugVoice,
    autoRegisterCommands: guildIds.length > 0,
    dashboardHost: DEFAULT_DASHBOARD_SETTINGS.host,
    dashboardPort: DEFAULT_DASHBOARD_SETTINGS.port,
    openDashboard: DEFAULT_DASHBOARD_SETTINGS.openDashboard,
    aloneFinalizeEnabled:
      settings.recording.aloneFinalizeEnabled ??
      DEFAULT_RECORDING_SETTINGS.productAloneFinalizeEnabled,
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
      claudeCommand: buildProductClaudeCommand(settings.ai),
      claudeModel: settings.ai.model ?? DEFAULT_AI_CLEANUP_SETTINGS.claudeModel,
      prepareTimeoutMs: DEFAULT_AI_CLEANUP_SETTINGS.prepareTimeoutMs,
      autoCleanupEnabled: isAiConfigured(settings.ai, secretStore),
      autoCleanupPollMs: DEFAULT_AI_CLEANUP_SETTINGS.autoCleanupPollMs,
      autoCleanupSessionBatchLimit:
        DEFAULT_AI_CLEANUP_SETTINGS.autoCleanupSessionBatchLimit,
      readinessRetryMs: DEFAULT_AI_CLEANUP_SETTINGS.readinessRetryMs,
      leaseMs: DEFAULT_AI_CLEANUP_SETTINGS.leaseMs,
      maxAttempts: DEFAULT_AI_CLEANUP_SETTINGS.maxAttempts,
      maxInputChars: DEFAULT_AI_CLEANUP_SETTINGS.maxInputChars,
      timeoutMs: DEFAULT_AI_CLEANUP_SETTINGS.timeoutMs,
      maxOutputBytes: DEFAULT_AI_CLEANUP_SETTINGS.maxOutputBytes,
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
  const locale = input.settings.app.locale ?? DEFAULT_DIRONG_LOCALE;
  const dashboardTheme =
    input.settings.app.dashboardTheme ?? DEFAULT_DIRONG_DASHBOARD_THEME;
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

  const discord = buildDiscordStatus(locale, input.settings, secrets.discordBot);
  const stt = buildSttStatus(locale, input.settings, secrets.openAi);
  const ai = buildAiStatus(locale, input.settings, secrets.claude);
  const notion = buildNotionStatus(
    locale,
    input.settings,
    secrets.notion,
    input.registryStore,
  );
  const recording = buildRecordingStatus(locale, discord, stt);
  const dataRetention = buildDataRetentionStatus(locale, input.settings);
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
    locale,
    notionSchemaLocale: locale,
    dashboardTheme,
    defaults: buildProductSetupDefaults(),
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
  const provider = settings.provider ?? DEFAULT_STT_SETTINGS.provider;
  const language = settings.language ?? DEFAULT_STT_SETTINGS.language;
  const timeoutMs = settings.timeoutMs ?? DEFAULT_STT_SETTINGS.timeoutMs;

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
        model: settings.openAiModel ?? DEFAULT_STT_SETTINGS.openai.model,
      },
    };
  }

  const localWhisper = buildProductLocalWhisperCommand(settings);
  return {
    provider: "local-whisper",
    language,
    timeoutMs,
    localWhisper: {
      command: localWhisper.command,
      args: localWhisper.args,
      model:
        settings.localWhisper?.model ?? DEFAULT_STT_SETTINGS.localWhisper.model,
      device:
        settings.localWhisper?.device ?? DEFAULT_STT_SETTINGS.localWhisper.device,
      computeType:
        settings.localWhisper?.computeType ??
        DEFAULT_STT_SETTINGS.localWhisper.computeType,
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
    apiVersion: DEFAULT_NOTION_SETTINGS.apiVersion,
    baseUrl: DEFAULT_NOTION_SETTINGS.baseUrl,
    targetUrl: DEFAULT_NOTION_SETTINGS.targetUrl,
    targetType: DEFAULT_NOTION_SETTINGS.targetType,
    uploadMode: settings.notion.uploadMode ?? DEFAULT_NOTION_SETTINGS.uploadMode,
    templateType: DEFAULT_NOTION_SETTINGS.templateType,
    includeTranscript: DEFAULT_NOTION_SETTINGS.includeTranscript,
    autoPollMs: DEFAULT_NOTION_SETTINGS.autoPollMs,
    leaseMs: DEFAULT_NOTION_SETTINGS.leaseMs,
    maxAttempts: DEFAULT_NOTION_SETTINGS.maxAttempts,
    propertyNames: { ...DEFAULT_NOTION_SETTINGS.propertyNames },
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
  return Boolean(settings.claudeProfile || settings.claudeCommand?.trim());
}

function buildDiscordStatus(
  locale: DirongLocale,
  settings: DirongLocalSettings,
  secret: SecretPresenceSnapshot,
): ProductSetupStatusSnapshot["features"]["discord"] {
  const missing = [
    settings.discord.applicationId ? null : "discord.applicationId",
    secret.configured ? null : "discord.botToken",
    (settings.discord.guildIds?.length ?? 0) > 0 ? null : "discord.guildAllowlist",
  ].filter((key): key is string => key !== null);

  if (missing.length > 0) {
    return withLocalizedText(locale, {
      status: "not_configured",
      messageKey: "setup.discord.status.notConfigured.message",
      userActionKey: "setup.discord.status.notConfigured.action",
      missing,
      applicationIdConfigured: Boolean(settings.discord.applicationId),
      guildAllowlistCount: settings.discord.guildIds?.length ?? 0,
    });
  }

  return withLocalizedText(locale, {
    status: "ready",
    messageKey: "setup.discord.status.ready.message",
    userActionKey: null,
    missing: [],
    applicationIdConfigured: true,
    guildAllowlistCount: settings.discord.guildIds?.length ?? 0,
  });
}

function buildSttStatus(
  locale: DirongLocale,
  settings: DirongLocalSettings,
  openAiSecret: SecretPresenceSnapshot,
): ProductSetupStatusSnapshot["features"]["stt"] {
  if (!settings.stt.provider) {
    return withLocalizedText(locale, {
      status: "not_configured",
      messageKey: "setup.stt.status.notConfigured.message",
      userActionKey: "setup.stt.status.notConfigured.action",
      missing: ["stt.provider"],
      provider: null,
      model: null,
    });
  }

  if (settings.stt.provider === "openai" && !openAiSecret.configured) {
    return withLocalizedText(locale, {
      status: "not_configured",
      messageKey: "setup.stt.status.openAiApiKeyMissing.message",
      userActionKey: "setup.stt.status.openAiApiKeyMissing.action",
      missing: ["stt.openAiApiKey"],
      provider: "openai",
      model: settings.stt.openAiModel ?? null,
    });
  }

  return withLocalizedText(locale, {
    status: "ready",
    messageKey: "setup.stt.status.ready.message",
    userActionKey: null,
    missing: [],
    provider: settings.stt.provider,
    model:
      settings.stt.provider === "openai"
        ? settings.stt.openAiModel ?? DEFAULT_STT_SETTINGS.openai.model
        : settings.stt.localWhisper?.model ??
          DEFAULT_STT_SETTINGS.localWhisper.model,
  });
}

function buildAiStatus(
  locale: DirongLocale,
  settings: DirongLocalSettings,
  claudeSecret: SecretPresenceSnapshot,
): ProductSetupStatusSnapshot["features"]["ai"] {
  if (settings.ai.provider !== "claude" || !settings.ai.mode) {
    return withLocalizedText(locale, {
      status: "not_configured",
      messageKey: "setup.ai.status.notConfigured.message",
      userActionKey: "setup.ai.status.notConfigured.action",
      missing: ["ai.provider", "ai.mode"],
      provider: settings.ai.provider ?? null,
      mode: settings.ai.mode ?? null,
    });
  }

  if (settings.ai.mode === "api" && !claudeSecret.configured) {
    return withLocalizedText(locale, {
      status: "not_configured",
      messageKey: "setup.ai.status.claudeApiKeyMissing.message",
      userActionKey: "setup.ai.status.claudeApiKeyMissing.action",
      missing: ["ai.claudeApiKey"],
      provider: "claude",
      mode: "api",
    });
  }

  if (
    settings.ai.mode === "cli" &&
    !settings.ai.claudeProfile &&
    !settings.ai.claudeCommand
  ) {
    return withLocalizedText(locale, {
      status: "not_configured",
      messageKey: "setup.ai.status.claudeCliCommandMissing.message",
      userActionKey: "setup.ai.status.claudeCliCommandMissing.action",
      missing: ["ai.claudeCommand"],
      provider: "claude",
      mode: "cli",
    });
  }

  return withLocalizedText(locale, {
    status: "ready",
    messageKey: "setup.ai.status.ready.message",
    userActionKey: null,
    missing: [],
    provider: "claude",
    mode: settings.ai.mode,
  });
}

function buildProductLocalWhisperCommand(settings: SttLocalSettings): {
  command: string;
  args: string[];
} {
  const localWhisper = settings.localWhisper;
  if (localWhisper?.profile) {
    return resolveLocalWhisperToolProfile(localWhisper.profile);
  }
  if (localWhisper?.command || localWhisper?.args) {
    const defaults = resolveLocalWhisperToolProfile(
      DEFAULT_LOCAL_WHISPER_TOOL_PROFILE,
    );
    return {
      command: localWhisper.command ?? defaults.command,
      args: localWhisper.args ?? defaults.args,
    };
  }
  return resolveLocalWhisperToolProfile(DEFAULT_LOCAL_WHISPER_TOOL_PROFILE);
}

function buildProductClaudeCommand(settings: AiLocalSettings): string {
  if (settings.claudeProfile) {
    return resolveClaudeToolProfile(settings.claudeProfile).command;
  }
  if (settings.claudeCommand) {
    return settings.claudeCommand;
  }
  return resolveClaudeToolProfile(DEFAULT_CLAUDE_TOOL_PROFILE).command;
}

function buildNotionStatus(
  locale: DirongLocale,
  settings: DirongLocalSettings,
  notionSecret: SecretPresenceSnapshot,
  registryStore: NotionRegistryStore | undefined,
): ProductSetupStatusSnapshot["features"]["notion"] {
  const parentPageConfigured = Boolean(settings.notion.parentPageUrl);
  const managedRegistry = readManagedNotionRegistrySnapshot(registryStore);
  const missing = [
    notionSecret.configured ? null : "notion.token",
    parentPageConfigured ? null : "notion.parentPageUrl",
  ].filter((key): key is string => key !== null);

  if (missing.length > 0) {
    return withLocalizedText(locale, {
      status: "not_configured",
      messageKey: "setup.notion.status.notConfigured.message",
      userActionKey: "setup.notion.status.notConfigured.action",
      missing,
      parentPageConfigured,
      managedRegistryReady: false,
      managedRegistryStatus: managedRegistry.status,
      managedRegistry,
    });
  }

  const managedRegistryReady = managedRegistry.status === "ready";

  if (managedRegistry.status === "partial") {
    return withLocalizedText(locale, {
      status: "blocked",
      messageKey: "setup.notion.status.registryPartial.message",
      userActionKey: "setup.notion.status.registryPartial.action",
      missing: ["notion.managedRegistry.partial"],
      parentPageConfigured,
      managedRegistryReady: false,
      managedRegistryStatus: managedRegistry.status,
      managedRegistry,
    });
  }

  if (!managedRegistryReady) {
    return withLocalizedText(locale, {
      status: "blocked",
      messageKey: "setup.notion.status.registryMissing.message",
      userActionKey: "setup.notion.status.registryMissing.action",
      missing: ["notion.managedRegistry"],
      parentPageConfigured,
      managedRegistryReady: false,
      managedRegistryStatus: managedRegistry.status,
      managedRegistry,
    });
  }

  return withLocalizedText(locale, {
    status: "ready",
    messageKey: "setup.notion.status.ready.message",
    userActionKey: null,
    missing: [],
    parentPageConfigured,
    managedRegistryReady: true,
    managedRegistryStatus: managedRegistry.status,
    managedRegistry,
  });
}

function buildRecordingStatus(
  locale: DirongLocale,
  discord: ProductSetupFeatureSnapshot,
  stt: ProductSetupFeatureSnapshot,
): ProductSetupFeatureSnapshot {
  if (discord.status !== "ready" || stt.status !== "ready") {
    return withLocalizedText(locale, {
      status: "blocked",
      messageKey: "setup.recording.status.blocked.message",
      userActionKey: "setup.recording.status.blocked.action",
      missing: [
        ...(discord.status === "ready" ? [] : ["discord"]),
        ...(stt.status === "ready" ? [] : ["stt"]),
      ],
    });
  }

  return withLocalizedText(locale, {
    status: "ready",
    messageKey: "setup.recording.status.ready.message",
    userActionKey: null,
    missing: [],
  });
}

function buildDataRetentionStatus(
  locale: DirongLocale,
  settings: DirongLocalSettings,
): ProductSetupStatusSnapshot["features"]["dataRetention"] {
  return withLocalizedText(locale, {
    status: "ready",
    messageKey: "setup.dataRetention.status.ready.message",
    userActionKey: null,
    missing: [],
    deleteAudioAfterNotionUpload:
      settings.retention.deleteAudioAfterNotionUpload ??
      DEFAULT_RETENTION_SETTINGS.deleteAudioAfterNotionUpload,
    textDraftRetentionDays:
      settings.retention.textDraftRetentionDays ??
      DEFAULT_RETENTION_SETTINGS.textDraftRetentionDays,
  });
}

function buildProductSetupDefaults(): ProductSetupDefaultsSnapshot {
  return {
    stt: {
      provider: DEFAULT_STT_SETTINGS.provider,
      language: DEFAULT_STT_SETTINGS.language,
      timeoutMs: DEFAULT_STT_SETTINGS.timeoutMs,
      openAiModel: DEFAULT_STT_SETTINGS.openai.model,
      localWhisper: {
        profile: DEFAULT_STT_SETTINGS.localWhisper.profile,
        model: DEFAULT_STT_SETTINGS.localWhisper.model,
        device: DEFAULT_STT_SETTINGS.localWhisper.device,
        computeType: DEFAULT_STT_SETTINGS.localWhisper.computeType,
      },
    },
    ai: { ...DEFAULT_SETUP_AI_SETTINGS },
    retention: { ...DEFAULT_RETENTION_SETTINGS },
    dashboard: {
      locale: DEFAULT_DASHBOARD_SETTINGS.locale,
      theme: DEFAULT_DASHBOARD_SETTINGS.theme,
      themes: [...DEFAULT_DASHBOARD_SETTINGS.themes],
    },
  };
}

function withLocalizedText<T extends { status: ProductFeatureStatus; missing: string[] }>(
  locale: DirongLocale,
  input: T & { messageKey: LocaleKey; userActionKey: LocaleKey | null },
): T & ProductSetupFeatureSnapshot {
  const message = t(locale, input.messageKey);
  const userAction = input.userActionKey ? t(locale, input.userActionKey) : null;
  return {
    ...input,
    message,
    userAction,
    display: buildHumanStatusDisplay(locale, {
      ...setupDisplayKeysForMessage(input.messageKey),
      status: input.status,
      message,
      userAction,
      messageKey: input.messageKey,
      userActionKey: input.userActionKey,
      details: [{ label: "missing", value: input.missing }],
    }),
  };
}

function setupDisplayKeysForMessage(
  messageKey: LocaleKey,
): Pick<
  HumanStatusDisplayInput,
  "titleKey" | "descriptionKey" | "nextActionKey"
> {
  switch (messageKey) {
    case "setup.discord.status.ready.message":
      return {
        titleKey: "statusDisplay.discord.ready.title",
        descriptionKey: "statusDisplay.discord.ready.description",
      };
    case "setup.stt.status.notConfigured.message":
      return {
        titleKey: "statusDisplay.stt.notConfigured.title",
        descriptionKey: "statusDisplay.stt.notConfigured.description",
        nextActionKey: "statusDisplay.stt.notConfigured.nextAction",
      };
    case "setup.stt.status.openAiApiKeyMissing.message":
      return {
        titleKey: "statusDisplay.stt.openAiApiKeyMissing.title",
        descriptionKey: "statusDisplay.stt.openAiApiKeyMissing.description",
        nextActionKey: "statusDisplay.stt.openAiApiKeyMissing.nextAction",
      };
    case "setup.stt.status.ready.message":
      return {
        titleKey: "statusDisplay.stt.ready.title",
        descriptionKey: "statusDisplay.stt.ready.description",
      };
    case "setup.ai.status.notConfigured.message":
      return {
        titleKey: "statusDisplay.claude.notConfigured.title",
        descriptionKey: "statusDisplay.claude.notConfigured.description",
        nextActionKey: "statusDisplay.claude.notConfigured.nextAction",
      };
    case "setup.ai.status.claudeApiKeyMissing.message":
      return {
        titleKey: "statusDisplay.claude.apiKeyMissing.title",
        descriptionKey: "statusDisplay.claude.apiKeyMissing.description",
        nextActionKey: "statusDisplay.claude.apiKeyMissing.nextAction",
      };
    case "setup.ai.status.claudeCliCommandMissing.message":
      return {
        titleKey: "statusDisplay.claude.cliCommandMissing.title",
        descriptionKey: "statusDisplay.claude.cliCommandMissing.description",
        nextActionKey: "statusDisplay.claude.cliCommandMissing.nextAction",
      };
    case "setup.ai.status.ready.message":
      return {
        titleKey: "statusDisplay.claude.ready.title",
        descriptionKey: "statusDisplay.claude.ready.description",
      };
    case "setup.notion.status.notConfigured.message":
      return {
        titleKey: "statusDisplay.notion.notConfigured.title",
        descriptionKey: "statusDisplay.notion.notConfigured.description",
        nextActionKey: "statusDisplay.notion.notConfigured.nextAction",
      };
    case "setup.notion.status.registryMissing.message":
      return {
        titleKey: "statusDisplay.notion.registryMissing.title",
        descriptionKey: "statusDisplay.notion.registryMissing.description",
        nextActionKey: "statusDisplay.notion.registryMissing.nextAction",
      };
    case "setup.notion.status.registryPartial.message":
      return {
        titleKey: "statusDisplay.notion.registryPartial.title",
        descriptionKey: "statusDisplay.notion.registryPartial.description",
        nextActionKey: "statusDisplay.notion.registryPartial.nextAction",
      };
    case "setup.notion.status.ready.message":
      return {
        titleKey: "statusDisplay.notion.ready.title",
        descriptionKey: "statusDisplay.notion.ready.description",
      };
    case "setup.recording.status.blocked.message":
      return {
        titleKey: "statusDisplay.recording.blocked.title",
        descriptionKey: "statusDisplay.recording.blocked.description",
        nextActionKey: "statusDisplay.recording.blocked.nextAction",
      };
    case "setup.recording.status.ready.message":
      return {
        titleKey: "statusDisplay.recording.ready.title",
        descriptionKey: "statusDisplay.recording.ready.description",
      };
    case "setup.dataRetention.status.ready.message":
      return {
        titleKey: "statusDisplay.dataRetention.ready.title",
        descriptionKey: "statusDisplay.dataRetention.ready.description",
      };
    case "setup.discord.status.notConfigured.message":
    default:
      return {
        titleKey: "statusDisplay.discord.notConfigured.title",
        descriptionKey: "statusDisplay.discord.notConfigured.description",
        nextActionKey: "statusDisplay.discord.notConfigured.nextAction",
      };
  }
}
