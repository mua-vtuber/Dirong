import type { Phase1Config } from "../config.js";
import { t, type LocaleKey } from "../i18n/catalog.js";
import {
  buildHumanStatusDisplay,
  type HumanStatusDisplay,
  type HumanStatusDisplayInput,
} from "../messages/human-status.js";
import {
  DEFAULT_NOTION_API_VERSION,
  DEFAULT_NOTION_BASE_URL,
  DEFAULT_NOTION_PROPERTY_NAMES,
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
      claudeCommand: buildProductClaudeCommand(settings.ai),
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

  const localWhisper = buildProductLocalWhisperCommand(settings);
  return {
    provider: "local-whisper",
    language,
    timeoutMs,
    localWhisper: {
      command: localWhisper.command,
      args: localWhisper.args,
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
        ? settings.stt.openAiModel ?? "gpt-4o-mini-transcribe"
        : settings.stt.localWhisper?.model ?? "small",
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
      settings.retention.deleteAudioAfterNotionUpload ?? true,
    textDraftRetentionDays: settings.retention.textDraftRetentionDays ?? 30,
  });
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
