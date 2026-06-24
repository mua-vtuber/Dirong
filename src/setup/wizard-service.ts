import { existsSync } from "node:fs";
import path from "node:path";
import {
  Client,
  Events,
  GatewayIntentBits,
  type ClientUser,
} from "discord.js";
import { redactSensitiveText } from "../errors.js";
import { t, type LocaleKey } from "../i18n/catalog.js";
import {
  buildHumanStatusDisplay,
  type HumanStatusDisplay,
  type HumanStatusDisplayInput,
} from "../messages/human-status.js";
import {
  createNotionClient,
  NotionApiError,
  type NotionClient,
} from "../notion/client.js";
import { createManagedNotionSchema } from "../notion/managed-schema.js";
import { readManagedNotionRegistrySnapshot } from "../notion/managed-registry.js";
import type { NotionLocale } from "../notion/schema-presets.js";
import { parseNotionPageUrl } from "../notion/target.js";
import { readNotionUploadMode } from "../notion/settings.js";
import type { NotionRegistryStore } from "../notion/registry-store.js";
import type { ProjectStore } from "../projects/project-store.js";
import {
  DEFAULT_PROJECT_ID,
  projectNotionTokenSecretRef,
  type DirongProjectRow,
} from "../projects/project-types.js";
import { runChild } from "../process/run-child.js";
import { validateDashboardCommandInput } from "../process/command-policy.js";
import {
  isAiProviderName,
  supportsAiProviderMode,
  type AiProviderName,
} from "../settings/ai-providers.js";
import type { DirongUserDataPaths } from "../settings/dirong-user-data.js";
import {
  DEFAULT_DIRONG_LOCALE,
  isDirongLocale,
  type AiProviderMode,
  type DirongLocale,
  type DirongLocalSettings,
  type LocalWhisperLocalSettings,
  LocalSettingsStore,
} from "../settings/local-settings-store.js";
import {
  CREATABLE_NOTION_SCHEMA_LOCALES,
  DEFAULT_AI_CLEANUP_SETTINGS,
  DEFAULT_MEETING_NOTES_LANGUAGE,
  DEFAULT_NOTION_SETTINGS,
  DEFAULT_RECORDING_SETTINGS,
  DEFAULT_RETENTION_SETTINGS,
  DEFAULT_SETUP_AI_MODEL_BY_PROVIDER,
  DEFAULT_SETUP_AI_SETTINGS,
  DEFAULT_STT_SETTINGS,
  RETENTION_DAYS_MAX,
  RETENTION_DAYS_MIN,
  STT_TIMEOUT_MS_MAX,
  STT_TIMEOUT_MS_MIN,
  SUPPORTED_CLAUDE_SETUP_MODELS,
  type ClaudeSetupModel,
} from "../settings/defaults.js";
import {
  DEFAULT_SECRET_REFS,
  LocalSecretStore,
} from "../settings/local-secret-store.js";
import {
  buildSettingsRuntimeEffect,
  buildProductSetupStatus,
  type SettingsRuntimeEffect,
  type SettingsRuntimeEffectScope,
  type ProductSetupStatusSnapshot,
} from "../settings/product-settings.js";
import {
  defaultAiToolProfile,
  DEFAULT_CLAUDE_TOOL_PROFILE,
  DEFAULT_LOCAL_WHISPER_TOOL_PROFILE,
  isAiToolProfileForProvider,
  isClaudeToolProfile,
  isLocalWhisperToolProfile,
  matchesAiToolProfile,
  matchesClaudeToolProfile,
  matchesLocalWhisperToolProfile,
  resolveAiToolProfile,
  resolveClaudeToolProfile,
  type AiToolProfile,
  type ClaudeToolProfile,
  type LocalWhisperToolProfile,
} from "../settings/tool-profiles.js";
import {
  isLocalWhisperInstallModel,
  LocalWhisperInstallService,
  type LocalWhisperInstallSnapshot,
  type LocalWhisperInstaller,
} from "./local-whisper-install-service.js";
import {
  DefaultOpenAiSttConnectionTester,
  type OpenAiSttConnectionTester,
} from "./openai-stt-connection-test.js";

export type SetupWizardStepId =
  | "language"
  | "discordApplication"
  | "discordBotToken"
  | "discordGuild"
  | "stt"
  | "ai"
  | "notionToken"
  | "notionParentPage"
  | "notionManagedDatabases"
  | "projectName";

export type SetupWizardStepStatus = "ready" | "current" | "locked";

export type SetupWizardStepSnapshot = {
  id: SetupWizardStepId;
  status: SetupWizardStepStatus;
};

export type SetupWizardStateSnapshot = ProductSetupStatusSnapshot & {
  wizard: {
    currentStep: SetupWizardStepId;
    completedStepCount: number;
    totalStepCount: number;
    inviteUrl: string | null;
    steps: SetupWizardStepSnapshot[];
  };
};

export type SetupWizardActionResult = {
  ok: boolean;
  status: "done" | "ready" | "failed" | "blocked" | "not_configured";
  messageKey: LocaleKey;
  message: string;
  userActionKey: LocaleKey | null;
  userAction: string | null;
  display?: HumanStatusDisplay;
  runtimeEffect?: SettingsRuntimeEffect;
  httpStatus: number;
  setup: SetupWizardStateSnapshot;
  [key: string]: unknown;
};

export type SetupWizardInstallActionResult = SetupWizardActionResult & {
  install: LocalWhisperInstallSnapshot;
};

export type SetupDiscordGuild = {
  id: string;
  name: string;
  iconUrl: string | null;
  owner: boolean | null;
};

export type DiscordConnectionTestResult = {
  botUserId: string;
  username: string;
};

export type DiscordSetupGateway = {
  testConnection(input: {
    botToken: string;
    applicationId: string;
  }): Promise<DiscordConnectionTestResult>;
  listGuilds(input: { botToken: string }): Promise<SetupDiscordGuild[]>;
};

export type AiSetupTestResult = {
  provider: AiProviderName;
  mode: AiProviderMode;
  model: string | null;
  detail: string | null;
};

export type AiSetupTester = {
  test(input:
    | {
        provider: AiProviderName;
        mode: "cli";
        command: string;
        model: string | null;
      }
    | {
        provider: "claude";
        mode: "api";
        apiKey: string;
        model: string | null;
      }): Promise<AiSetupTestResult>;
};

export type ClaudeSetupTestResult = AiSetupTestResult;
export type ClaudeSetupTester = AiSetupTester;

export type SetupWizardServiceOptions = {
  paths: DirongUserDataPaths;
  settingsStore: LocalSettingsStore;
  secretStore: LocalSecretStore;
  registryStore?: NotionRegistryStore;
  projectStore?: ProjectStore;
  discordGateway?: DiscordSetupGateway;
  claudeTester?: AiSetupTester;
  localWhisperInstaller?: LocalWhisperInstaller;
  openAiSttTester?: OpenAiSttConnectionTester;
  notionClientFactory?: (apiKey: string) => NotionClient;
  managedSchemaCreator?: typeof createManagedNotionSchema;
  now?: () => Date;
};

export function createProductSetupWizardService(input: {
  paths: DirongUserDataPaths;
  registryStore?: NotionRegistryStore;
  projectStore?: ProjectStore;
}): SetupWizardService {
  return new SetupWizardService({
    paths: input.paths,
    settingsStore: new LocalSettingsStore(input.paths.settingsFile),
    secretStore: new LocalSecretStore(input.paths.secretsFile),
    registryStore: input.registryStore,
    projectStore: input.projectStore,
  });
}

export class SetupWizardService {
  private readonly discordGateway: DiscordSetupGateway;
  private readonly claudeTester: AiSetupTester;
  private readonly localWhisperInstaller: LocalWhisperInstaller;
  private readonly openAiSttTester: OpenAiSttConnectionTester;
  private readonly notionClientFactory: (apiKey: string) => NotionClient;
  private readonly managedSchemaCreator: typeof createManagedNotionSchema;
  private readonly now: () => Date;

  constructor(private readonly options: SetupWizardServiceOptions) {
    this.discordGateway = options.discordGateway ?? new DiscordJsSetupGateway();
    this.claudeTester = options.claudeTester ?? new DefaultClaudeSetupTester();
    this.localWhisperInstaller =
      options.localWhisperInstaller ??
      new LocalWhisperInstallService({ paths: options.paths });
    this.openAiSttTester =
      options.openAiSttTester ?? new DefaultOpenAiSttConnectionTester();
    this.notionClientFactory = options.notionClientFactory ?? createDefaultNotionClient;
    this.managedSchemaCreator =
      options.managedSchemaCreator ?? createManagedNotionSchema;
    this.now = options.now ?? (() => new Date());
  }

  getState(): SetupWizardStateSnapshot {
    return this.buildState();
  }

  saveDiscordApplicationId(body: unknown): SetupWizardActionResult {
    const applicationId = readCleanString(body, [
      "applicationId",
      "clientId",
      "discordApplicationId",
    ]);
    if (!applicationId || !isDiscordSnowflake(applicationId)) {
      return this.result({
        ok: false,
        status: "failed",
        httpStatus: 400,
        messageKey: "setup.discord.applicationId.error.invalid.message",
        userActionKey: "setup.discord.applicationId.error.invalid.action",
      });
    }

    this.options.settingsStore.update((settings) => ({
      ...settings,
      discord: {
        ...settings.discord,
        applicationId,
      },
    }));

    return this.result({
      ok: true,
      status: "done",
      messageKey: "setup.discord.applicationId.save.done.message",
      userActionKey: null,
      runtimeEffectScope: "discord",
      inviteUrl: buildDiscordInviteUrl(applicationId),
    });
  }

  saveDiscordBotToken(body: unknown): SetupWizardActionResult {
    const botToken = readCleanString(body, ["botToken", "token"]);
    if (!botToken) {
      return this.result({
        ok: false,
        status: "failed",
        httpStatus: 400,
        messageKey: "setup.discord.botToken.error.missing.message",
        userActionKey: "setup.discord.botToken.error.missing.action",
      });
    }

    this.options.secretStore.set(DEFAULT_SECRET_REFS.discordBotToken, botToken);
    this.options.settingsStore.update((settings) => ({
      ...settings,
      discord: {
        ...settings.discord,
        botTokenSecretRef: DEFAULT_SECRET_REFS.discordBotToken,
      },
    }));

    return this.result({
      ok: true,
      status: "done",
      messageKey: "setup.discord.botToken.save.done.message",
      userActionKey: null,
      runtimeEffectScope: "discord",
      secret: this.options.secretStore.snapshot(DEFAULT_SECRET_REFS.discordBotToken),
    });
  }

  async testDiscordConnection(): Promise<SetupWizardActionResult> {
    const settings = this.options.settingsStore.read();
    const applicationId = settings.discord.applicationId;
    const botToken = this.options.secretStore.get(
      settings.discord.botTokenSecretRef ?? DEFAULT_SECRET_REFS.discordBotToken,
    );
    if (!applicationId || !botToken) {
      return this.result({
        ok: false,
        status: "not_configured",
        httpStatus: 400,
        messageKey: "setup.discord.connection.error.notConfigured.message",
        userActionKey: "setup.discord.connection.error.notConfigured.action",
      });
    }

    try {
      const connection = await this.discordGateway.testConnection({
        botToken,
        applicationId,
      });
      return this.result({
        ok: true,
        status: "done",
        messageKey: "setup.discord.connection.test.done.message",
        userActionKey: null,
        discord: {
          botUserId: connection.botUserId,
          username: connection.username,
          inviteUrl: buildDiscordInviteUrl(applicationId),
        },
      });
    } catch (error) {
      return this.result({
        ok: false,
        status: "failed",
        httpStatus: 400,
        messageKey: "setup.discord.connection.error.failed.message",
        userActionKey: "setup.discord.connection.error.failed.action",
        technicalDetail: errorMessage(error),
      });
    }
  }

  async listDiscordGuilds(): Promise<SetupWizardActionResult> {
    const settings = this.options.settingsStore.read();
    const botToken = this.options.secretStore.get(
      settings.discord.botTokenSecretRef ?? DEFAULT_SECRET_REFS.discordBotToken,
    );
    if (!botToken) {
      return this.result({
        ok: false,
        status: "not_configured",
        httpStatus: 400,
        messageKey: "setup.discord.guilds.error.notConfigured.message",
        userActionKey: "setup.discord.guilds.error.notConfigured.action",
        guilds: [],
      });
    }

    try {
      const guilds = await this.discordGateway.listGuilds({ botToken });
      return this.result({
        ok: true,
        status: "done",
        messageKey: "setup.discord.guilds.list.done.message",
        userActionKey: guilds.length === 0
          ? "setup.discord.guilds.list.empty.action"
          : null,
        guilds,
      });
    } catch (error) {
      return this.result({
        ok: false,
        status: "failed",
        httpStatus: 400,
        messageKey: "setup.discord.guilds.error.failed.message",
        userActionKey: "setup.discord.guilds.error.failed.action",
        technicalDetail: errorMessage(error),
        guilds: [],
      });
    }
  }

  async saveDiscordGuildAllowlist(
    body: unknown,
  ): Promise<SetupWizardActionResult> {
    const guildIds = readStringList(body, "guildIds");
    if (guildIds.length === 0 || guildIds.some((id) => !isDiscordSnowflake(id))) {
      return this.result({
        ok: false,
        status: "failed",
        httpStatus: 400,
        messageKey: "setup.discord.guildAllowlist.error.invalid.message",
        userActionKey: "setup.discord.guildAllowlist.error.invalid.action",
      });
    }
    if (this.options.projectStore && guildIds.length !== 1) {
      return this.result({
        ok: false,
        status: "failed",
        httpStatus: 400,
        messageKey: "setup.discord.guildAllowlist.error.invalid.message",
        userActionKey: "setup.discord.guildAllowlist.error.invalid.action",
      });
    }

    const activeProject = this.readActiveProjectForSetup();
    if (!activeProject.ok) {
      return this.result(activeProject.error);
    }

    const settings = this.options.settingsStore.read();
    const botToken = this.options.secretStore.get(
      settings.discord.botTokenSecretRef ?? DEFAULT_SECRET_REFS.discordBotToken,
    );
    if (!botToken) {
      return this.result({
        ok: false,
        status: "not_configured",
        httpStatus: 400,
        messageKey: "setup.discord.guilds.error.notConfigured.message",
        userActionKey: "setup.discord.guilds.error.notConfigured.action",
      });
    }

    try {
      const botGuilds = await this.discordGateway.listGuilds({ botToken });
      const allowedGuildIds = new Set(botGuilds.map((guild) => guild.id));
      const unknownGuildIds = guildIds.filter((id) => !allowedGuildIds.has(id));
      if (unknownGuildIds.length > 0) {
        return this.result({
          ok: false,
          status: "blocked",
          httpStatus: 400,
          messageKey: "setup.discord.guildAllowlist.error.notInBotGuilds.message",
          userActionKey: "setup.discord.guildAllowlist.error.notInBotGuilds.action",
          unknownGuildCount: unknownGuildIds.length,
        });
      }

      const selectedGuilds = botGuilds.filter((guild) => guildIds.includes(guild.id));
      if (this.options.projectStore && activeProject.project) {
        const selectedGuild = selectedGuilds[0];
        if (!selectedGuild) {
          throw new Error("Selected Discord guild was not found.");
        }
        this.options.projectStore.updateProjectDiscordGuildFields({
          projectId: activeProject.project.id,
          guildId: selectedGuild.id,
          guildName: selectedGuild.name,
          guildIconUrl: selectedGuild.iconUrl,
          nowIso: this.now().toISOString(),
        });
        this.writeProjectCompatibilityProjection({
          guildIds: [selectedGuild.id],
        });
      } else {
        this.options.settingsStore.update((nextSettings) => ({
          ...nextSettings,
          discord: {
            ...nextSettings.discord,
            guildIds,
          },
        }));
      }

      return this.result({
        ok: true,
        status: "done",
        messageKey: "setup.discord.guildAllowlist.save.done.message",
        userActionKey: null,
        runtimeEffectScope: "discord",
        guilds: selectedGuilds,
      });
    } catch (error) {
      return this.result({
        ok: false,
        status: "failed",
        httpStatus: 400,
        messageKey: "setup.discord.guilds.error.failed.message",
        userActionKey: "setup.discord.guilds.error.failed.action",
        technicalDetail: errorMessage(error),
      });
    }
  }

  saveSttSettings(body: unknown): SetupWizardActionResult {
    const provider = readCleanString(body, ["provider"]);
    if (provider !== "local-whisper" && provider !== "openai") {
      return this.result({
        ok: false,
        status: "failed",
        httpStatus: 400,
        messageKey: "setup.stt.settings.error.invalidProvider.message",
        userActionKey: "setup.stt.settings.error.invalidProvider.action",
      });
    }

    const model = readCleanString(body, ["model"]);
    if (model !== null && model.length > 80) {
      return this.result({
        ok: false,
        status: "failed",
        httpStatus: 400,
        messageKey: "setup.stt.settings.error.invalidModel.message",
        userActionKey: "setup.stt.settings.error.invalidModel.action",
      });
    }

    const validated = this.validateSttLanguageAndTimeout(body);
    if (!validated.ok) {
      return this.result(validated.error);
    }
    const { language, timeoutMs } = validated;
    const currentSettings = this.options.settingsStore.read();
    const settingsUpdate =
      provider === "openai"
        ? buildOpenAiSttSettings(
            body,
            currentSettings,
            model,
            language,
            timeoutMs,
          )
        : buildLocalWhisperSettings(body, model, language, timeoutMs);
    if (!settingsUpdate.ok) {
      return this.result(settingsUpdate.error);
    }
    if (settingsUpdate.openAiApiKey) {
      this.options.secretStore.set(
        DEFAULT_SECRET_REFS.openAiApiKey,
        settingsUpdate.openAiApiKey,
      );
    }

    this.options.settingsStore.update((settings) => ({
      ...settings,
      stt: settingsUpdate.stt,
    }));

    return this.result({
      ok: true,
      status: "done",
      messageKey: "setup.stt.settings.save.done.message",
      userActionKey: null,
      runtimeEffectScope: "stt",
      stt: settingsUpdate.stt,
    });
  }

  getLocalWhisperInstallSnapshot(): LocalWhisperInstallSnapshot {
    const snapshot = this.localWhisperInstaller.getSnapshot();
    if (snapshot.status !== "idle") {
      return snapshot;
    }

    const settings = this.options.settingsStore.read();
    const model =
      settings.stt.localWhisper?.model ?? DEFAULT_STT_SETTINGS.localWhisper.model;
    if (
      settings.stt.provider === "local-whisper" &&
      isLocalWhisperInstallModel(model)
    ) {
      const modelPath = path.join(
        this.options.paths.modelsDir,
        `faster-whisper-${model}`,
      );
      if (hasFasterWhisperModelFiles(modelPath)) {
        const checkedAt = this.now().toISOString();
        return {
          status: "done",
          stage: "done",
          model,
          message: "local-whisper is ready.",
          detail: modelPath,
          lastLog: null,
          startedAt: null,
          updatedAt: checkedAt,
          completedAt: checkedAt,
        };
      }
    }
    return snapshot;
  }

  startLocalWhisperInstall(body: unknown): SetupWizardInstallActionResult {
    const modelInput = readCleanString(body, ["model"]);
    const model = modelInput ?? DEFAULT_STT_SETTINGS.localWhisper.model;
    if (!isLocalWhisperInstallModel(model)) {
      return this.result({
        ok: false,
        status: "failed",
        httpStatus: 400,
        messageKey: "setup.stt.settings.error.invalidModel.message",
        userActionKey: "setup.stt.settings.error.invalidModel.action",
        install: this.localWhisperInstaller.getSnapshot(),
      }) as SetupWizardInstallActionResult;
    }

    const install = this.localWhisperInstaller.start({
      model,
      device:
        readCleanString(body, ["device"]) ??
        DEFAULT_STT_SETTINGS.localWhisper.device,
      computeType:
        readCleanString(body, ["computeType"]) ??
        DEFAULT_STT_SETTINGS.localWhisper.computeType,
    });
    return this.result({
      ok: true,
      status: "ready",
      httpStatus: install.status === "running" ? 202 : 200,
      messageKey: "setup.stt.settings.save.done.message",
      userActionKey: null,
      install,
    }) as SetupWizardInstallActionResult;
  }

  async testAndSaveOpenAiSttSettings(
    body: unknown,
  ): Promise<SetupWizardActionResult> {
    const model = readCleanString(body, ["model"]) ??
      DEFAULT_STT_SETTINGS.openai.model;
    if (model.length > 80) {
      return this.result({
        ok: false,
        status: "failed",
        httpStatus: 400,
        messageKey: "setup.stt.settings.error.invalidModel.message",
        userActionKey: "setup.stt.settings.error.invalidModel.action",
      });
    }

    const validated = this.validateSttLanguageAndTimeout(body);
    if (!validated.ok) {
      return this.result(validated.error);
    }
    const { language, timeoutMs } = validated;
    const currentSettings = this.options.settingsStore.read();
    const apiKeyInput = readCleanString(body, ["apiKey", "openAiApiKey"]);
    const existingApiKey = this.options.secretStore.get(
      currentSettings.stt.openAiApiKeySecretRef ??
        DEFAULT_SECRET_REFS.openAiApiKey,
    );
    const apiKeyForTest = apiKeyInput ?? existingApiKey;
    if (!apiKeyForTest) {
      return this.result({
        ok: false,
        status: "not_configured",
        httpStatus: 400,
        messageKey: "setup.stt.openAiTest.error.missingKey.message",
        userActionKey: "setup.stt.openAiTest.error.missingKey.action",
      });
    }

    const testResult = await this.openAiSttTester.test({
      apiKey: apiKeyForTest,
      model,
      timeoutMs: Math.min(timeoutMs, 30000),
    });
    if (!testResult.ok) {
      return this.result({
        ok: false,
        status: "failed",
        httpStatus: 400,
        messageKey: "setup.stt.openAiTest.error.failed.message",
        userActionKey: "setup.stt.openAiTest.error.failed.action",
        technicalDetail: testResult.detail,
        provider: "openai",
        model,
      });
    }

    const settingsUpdate = buildOpenAiSttSettings(
      body,
      currentSettings,
      model,
      language,
      timeoutMs,
    );
    if (!settingsUpdate.ok) {
      return this.result(settingsUpdate.error);
    }
    if (settingsUpdate.openAiApiKey) {
      this.options.secretStore.set(
        DEFAULT_SECRET_REFS.openAiApiKey,
        settingsUpdate.openAiApiKey,
      );
    }
    this.options.settingsStore.update((settings) => ({
      ...settings,
      stt: settingsUpdate.stt,
    }));

    return this.result({
      ok: true,
      status: "done",
      messageKey: "setup.stt.openAiTest.done.message",
      userActionKey: null,
      runtimeEffectScope: "stt",
      provider: "openai",
      model: testResult.model,
      stt: settingsUpdate.stt,
    });
  }

  saveAiSettings(body: unknown): SetupWizardActionResult {
    const provider = readAiProviderInput(body);
    const mode = readCleanString(body, ["mode"]);
    if (mode !== "cli" && mode !== "api") {
      return this.result({
        ok: false,
        status: "failed",
        httpStatus: 400,
        messageKey: "setup.ai.claude.error.invalidMode.message",
        userActionKey: "setup.ai.claude.error.invalidMode.action",
      });
    }
    if (!supportsAiProviderMode(provider, mode)) {
      return this.result({
        ok: false,
        status: "failed",
        httpStatus: 400,
        messageKey: "setup.ai.claude.error.invalidMode.message",
        userActionKey: "setup.ai.claude.error.invalidMode.action",
      });
    }

    const aiModel = readAiModelInput(provider, body);
    if (!aiModel.ok) {
      return this.result(aiModel.error);
    }
    if (mode === "cli") {
      const aiProfile = readAiProfileInput(provider, body);
      if (!aiProfile.ok) {
        return this.result(aiProfile.error);
      }
      let savedModel: string = DEFAULT_SETUP_AI_MODEL_BY_PROVIDER[provider];
      this.options.settingsStore.update((settings) => ({
        ...settings,
        ai: (() => {
          savedModel = resolveAiSetupModel(
            provider,
            aiModel.model ?? settings.ai.model,
          );
          return {
            provider,
            mode,
            model: savedModel,
            cliProfile: aiProfile.profile,
            ...(provider === "claude"
              ? { claudeProfile: aiProfile.profile as ClaudeToolProfile }
              : {}),
            apiKeySecretRef: settings.ai.apiKeySecretRef,
          };
        })(),
      }));

      return this.result({
        ok: true,
        status: "done",
        messageKey: "setup.ai.claude.save.done.message",
        userActionKey: null,
        runtimeEffectScope: "ai",
        ai: {
          provider,
          mode,
          model: savedModel,
          cliProfile: aiProfile.profile,
        },
      });
    }

    const apiKey = readCleanString(body, ["apiKey", "claudeApiKey"]);
    const current = this.options.settingsStore.read();
    const ref = current.ai.apiKeySecretRef ?? DEFAULT_SECRET_REFS.claudeApiKey;
    if (!apiKey && !this.options.secretStore.has(ref)) {
      return this.result({
        ok: false,
        status: "failed",
        httpStatus: 400,
        messageKey: "setup.ai.claude.error.apiKeyMissing.message",
        userActionKey: "setup.ai.claude.error.apiKeyMissing.action",
      });
    }
    if (apiKey) {
      this.options.secretStore.set(DEFAULT_SECRET_REFS.claudeApiKey, apiKey);
    }

    let savedModel: string = DEFAULT_SETUP_AI_SETTINGS.model;
    this.options.settingsStore.update((settings) => ({
      ...settings,
      ai: (() => {
        savedModel = resolveAiSetupModel(
          "claude",
          aiModel.model ?? settings.ai.model,
        );
        return {
          provider: "claude",
          mode,
          model: savedModel,
          claudeCommand: settings.ai.claudeCommand,
          apiKeySecretRef: DEFAULT_SECRET_REFS.claudeApiKey,
        };
      })(),
    }));

    return this.result({
      ok: true,
      status: "done",
      messageKey: "setup.ai.claude.save.done.message",
      userActionKey: null,
      runtimeEffectScope: "ai",
      ai: {
        provider: "claude",
        mode,
        model: savedModel,
        secret: this.options.secretStore.snapshot(DEFAULT_SECRET_REFS.claudeApiKey),
      },
    });
  }

  saveClaudeSettings(body: unknown): SetupWizardActionResult {
    return this.saveAiSettings(body);
  }

  saveRecordingSettings(body: unknown): SetupWizardActionResult {
    const current = this.options.settingsStore.read();
    const enabled =
      readBoolean(body, "aloneFinalizeEnabled") ??
      readBoolean(body, "enabled") ??
      current.recording.aloneFinalizeEnabled ??
      DEFAULT_RECORDING_SETTINGS.productAloneFinalizeEnabled;
    const graceSeconds =
      readPositiveInteger(body, "aloneFinalizeGraceSeconds") ??
      readPositiveInteger(body, "graceSeconds");
    const graceMs =
      readPositiveInteger(body, "aloneFinalizeGraceMs") ??
      readPositiveInteger(body, "graceMs") ??
      (graceSeconds === null ? null : graceSeconds * 1000) ??
      current.recording.aloneFinalizeGraceMs ??
      DEFAULT_RECORDING_SETTINGS.aloneFinalizeGraceMs;

    if (graceMs < 5000 || graceMs > 3600000) {
      return this.result({
        ok: false,
        status: "failed",
        httpStatus: 400,
        messageKey: "setup.recording.aloneFinalize.error.invalidGrace.message",
        userActionKey: "setup.recording.aloneFinalize.error.invalidGrace.action",
      });
    }

    this.options.settingsStore.update((settings) => ({
      ...settings,
      recording: {
        ...settings.recording,
        aloneFinalizeEnabled: enabled,
        aloneFinalizeGraceMs: graceMs,
      },
    }));

    return this.result({
      ok: true,
      status: "done",
      messageKey: "setup.recording.aloneFinalize.save.done.message",
      userActionKey: null,
      runtimeEffectScope: "recording",
      recording: {
        aloneFinalizeEnabled: enabled,
        aloneFinalizeGraceMs: graceMs,
      },
    });
  }

  saveRetentionSettings(body: unknown): SetupWizardActionResult {
    const current = this.options.settingsStore.read();
    const textDraftRetentionDays =
      readPositiveInteger(body, "textDraftRetentionDays") ??
      current.retention.textDraftRetentionDays ??
      DEFAULT_RETENTION_SETTINGS.textDraftRetentionDays;

    if (
      textDraftRetentionDays < RETENTION_DAYS_MIN ||
      textDraftRetentionDays > RETENTION_DAYS_MAX
    ) {
      return this.result({
        ok: false,
        status: "failed",
        httpStatus: 400,
        messageKey: "setup.dataRetention.error.invalidDays.message",
        userActionKey: "setup.dataRetention.error.invalidDays.action",
      });
    }

    this.options.settingsStore.update((settings) => ({
      ...settings,
      retention: {
        // deleteAudioAfterNotionUpload은 읽기전용 정책이므로 그대로 보존한다.
        ...settings.retention,
        textDraftRetentionDays,
      },
    }));

    return this.result({
      ok: true,
      status: "done",
      messageKey: "setup.dataRetention.save.done.message",
      userActionKey: null,
      retention: { textDraftRetentionDays },
    });
  }

  private validateSttLanguageAndTimeout(
    body: unknown,
  ):
    | { ok: true; language: DirongLocale; timeoutMs: number }
    | { ok: false; error: ResultInput } {
    const languageInput = readCleanString(body, ["language"]);
    if (languageInput !== null && !isDirongLocale(languageInput)) {
      return {
        ok: false,
        error: {
          ok: false,
          status: "failed",
          httpStatus: 400,
          messageKey: "setup.stt.settings.error.invalidLanguage.message",
          userActionKey: "setup.stt.settings.error.invalidLanguage.action",
        },
      };
    }
    const language = (languageInput ?? DEFAULT_MEETING_NOTES_LANGUAGE) as DirongLocale;
    const timeoutMsInput = readPositiveInteger(body, "timeoutMs");
    if (
      timeoutMsInput !== null &&
      (timeoutMsInput < STT_TIMEOUT_MS_MIN || timeoutMsInput > STT_TIMEOUT_MS_MAX)
    ) {
      return {
        ok: false,
        error: {
          ok: false,
          status: "failed",
          httpStatus: 400,
          messageKey: "setup.stt.settings.error.invalidTimeout.message",
          userActionKey: "setup.stt.settings.error.invalidTimeout.action",
        },
      };
    }
    const timeoutMs = timeoutMsInput ?? DEFAULT_STT_SETTINGS.timeoutMs;
    return { ok: true, language, timeoutMs };
  }

  async testAiConnection(): Promise<SetupWizardActionResult> {
    const settings = this.options.settingsStore.read();
    if (!settings.ai.provider || !settings.ai.mode) {
      return this.result({
        ok: false,
        status: "not_configured",
        httpStatus: 400,
        messageKey: "setup.ai.claude.test.error.notConfigured.message",
        userActionKey: "setup.ai.claude.test.error.notConfigured.action",
      });
    }

    try {
      const testResult =
        settings.ai.mode === "api"
          ? await this.testClaudeApi(settings)
          : await this.testAiCli(settings);
      return this.result({
        ok: true,
        status: "done",
        messageKey: "setup.ai.claude.test.done.message",
        userActionKey: null,
        ai: testResult,
      });
    } catch (error) {
      return this.result({
        ok: false,
        status: "failed",
        httpStatus: 400,
        messageKey: "setup.ai.claude.test.error.failed.message",
        userActionKey: "setup.ai.claude.test.error.failed.action",
        technicalDetail: errorMessage(error),
      });
    }
  }

  async testClaudeConnection(): Promise<SetupWizardActionResult> {
    return this.testAiConnection();
  }

  saveNotionToken(body: unknown): SetupWizardActionResult {
    const token = readCleanString(body, ["token", "notionToken"]);
    if (!token) {
      return this.result({
        ok: false,
        status: "failed",
        httpStatus: 400,
        messageKey: "setup.notion.token.error.missing.message",
        userActionKey: "setup.notion.token.error.missing.action",
      });
    }

    const activeProject = this.readActiveProjectForSetup();
    if (!activeProject.ok) {
      return this.result(activeProject.error);
    }

    const secretRef = activeProject.project
      ? projectNotionTokenSecretRef(activeProject.project.id)
      : DEFAULT_SECRET_REFS.notionToken;
    this.options.secretStore.set(secretRef, token);
    if (activeProject.project && this.options.projectStore) {
      this.options.projectStore.updateProjectNotionFields({
        projectId: activeProject.project.id,
        notionTokenSecretRef: secretRef,
        nowIso: this.now().toISOString(),
      });
      this.writeProjectCompatibilityProjection({
        notionTokenSecretRef: secretRef,
      });
    } else {
      this.options.settingsStore.update((settings) => ({
        ...settings,
        notion: {
          ...settings.notion,
          tokenSecretRef: secretRef,
        },
      }));
    }

    return this.result({
      ok: true,
      status: "done",
      messageKey: "setup.notion.token.save.done.message",
      userActionKey: null,
      runtimeEffectScope: "notion",
      secret: this.options.secretStore.snapshot(secretRef),
    });
  }

  saveNotionParentPageUrl(body: unknown): SetupWizardActionResult {
    const parentPageUrl = readCleanString(body, [
      "parentPageUrl",
      "pageUrl",
      "url",
    ]);
    if (!parentPageUrl) {
      return this.result({
        ok: false,
        status: "failed",
        httpStatus: 400,
        messageKey: "setup.notion.parentPage.error.invalid.message",
        userActionKey: "setup.notion.parentPage.error.invalid.action",
      });
    }

    const parsed = parseNotionPageUrl(parentPageUrl);
    if (parsed.kind === "invalid") {
      return this.result({
        ok: false,
        status: "failed",
        httpStatus: 400,
        messageKey: "setup.notion.parentPage.error.invalid.message",
        userActionKey: "setup.notion.parentPage.error.invalid.action",
        reason: parsed.reason,
      });
    }

    const activeProject = this.readActiveProjectForSetup();
    if (!activeProject.ok) {
      return this.result(activeProject.error);
    }
    const normalizedUrl = parsed.url ?? parentPageUrl.trim();
    if (activeProject.project && this.options.projectStore) {
      this.options.projectStore.updateProjectNotionFields({
        projectId: activeProject.project.id,
        notionParentPageUrl: normalizedUrl,
        nowIso: this.now().toISOString(),
      });
      this.writeProjectCompatibilityProjection({
        notionParentPageUrl: normalizedUrl,
      });
    } else {
      this.options.settingsStore.update((settings) => ({
        ...settings,
        notion: {
          ...settings.notion,
          parentPageUrl: normalizedUrl,
        },
      }));
    }

    return this.result({
      ok: true,
      status: "done",
      messageKey: "setup.notion.parentPage.save.done.message",
      userActionKey: null,
      runtimeEffectScope: "notion",
      notion: { parentPageConfigured: true },
    });
  }

  saveNotionUploadMode(body: unknown): SetupWizardActionResult {
    const mode = readNotionUploadMode(readCleanString(body, ["uploadMode", "mode"]));
    if (!mode) {
      return this.result({
        ok: false,
        status: "failed",
        httpStatus: 400,
        messageKey: "setup.notion.uploadMode.error.invalid.message",
        userActionKey: "setup.notion.uploadMode.error.invalid.action",
      });
    }

    const activeProject = this.readActiveProjectForSetup();
    if (!activeProject.ok) {
      return this.result(activeProject.error);
    }

    if (activeProject.project && this.options.projectStore) {
      this.options.projectStore.updateProjectNotionFields({
        projectId: activeProject.project.id,
        notionUploadMode: mode,
        nowIso: this.now().toISOString(),
      });
      this.writeProjectCompatibilityProjection({ notionUploadMode: mode });
    } else {
      this.options.settingsStore.update((settings) => ({
        ...settings,
        notion: {
          ...settings.notion,
          uploadMode: mode,
        },
      }));
    }

    return this.result({
      ok: true,
      status: "done",
      messageKey: "setup.notion.uploadMode.save.done.message",
      userActionKey: null,
      runtimeEffectScope: "notion",
      notion: { uploadMode: mode },
    });
  }

  async verifyNotionParentPage(): Promise<SetupWizardActionResult> {
    const context = this.readNotionContext();
    if (!context.ok) {
      return this.result(context.error);
    }

    try {
      await context.client.retrievePage(context.parentPageId);
      return this.result({
        ok: true,
        status: "done",
        messageKey: "setup.notion.parentPage.verify.done.message",
        userActionKey: null,
        notion: { parentPageConfigured: true },
      });
    } catch (error) {
      return this.result({
        ok: false,
        status: "failed",
        httpStatus: 400,
        messageKey: "setup.notion.parentPage.verify.error.failed.message",
        userActionKey: "setup.notion.parentPage.verify.error.failed.action",
        technicalDetail: errorMessage(error),
      });
    }
  }

  async createManagedDatabases(): Promise<SetupWizardActionResult> {
    if (!this.options.registryStore) {
      return this.result({
        ok: false,
        status: "blocked",
        httpStatus: 500,
        messageKey: "setup.notion.managedDatabases.error.registryMissing.message",
        userActionKey: "setup.notion.managedDatabases.error.registryMissing.action",
      });
    }

    const activeProject = this.readActiveProjectForSetup();
    if (!activeProject.ok) {
      return this.result(activeProject.error);
    }
    const registryProjectId = activeProject.project?.id;
    const registrySnapshot = readManagedNotionRegistrySnapshot(
      this.options.registryStore,
      { projectId: registryProjectId },
    );
    if (registrySnapshot.status === "ready") {
      return this.result({
        ok: true,
        status: "ready",
        messageKey: "setup.notion.managedDatabases.create.existing.message",
        userActionKey: null,
        runtimeEffectScope: "notion",
        notion: registrySnapshot,
      });
    }

    if (registrySnapshot.status === "partial") {
      return this.result({
        ok: false,
        status: "blocked",
        httpStatus: 409,
        messageKey: "setup.notion.managedDatabases.error.partialRegistry.message",
        userActionKey: "setup.notion.managedDatabases.error.partialRegistry.action",
        notion: registrySnapshot,
      });
    }

    const context = this.readNotionContext();
    if (!context.ok) {
      return this.result(context.error);
    }

    const locale = this.options.settingsStore.read().app.locale ?? DEFAULT_DIRONG_LOCALE;
    if (!isCreatableNotionLocale(locale)) {
      return this.result({
        ok: false,
        status: "blocked",
        httpStatus: 400,
        messageKey: "setup.notion.managedDatabases.error.localeUnsupported.message",
        userActionKey: "setup.notion.managedDatabases.error.localeUnsupported.action",
      });
    }

    try {
      const created = await this.managedSchemaCreator({
        client: context.client,
        registryStore: this.options.registryStore,
        projectId: context.projectId,
        parentPageUrl: context.parentPageUrl,
        locale,
        nowIso: this.now().toISOString(),
      });
      return this.result({
        ok: true,
        status: "done",
        messageKey: "setup.notion.managedDatabases.create.done.message",
        userActionKey: null,
        runtimeEffectScope: "notion",
        notion: {
          locale: created.locale,
          parentPageUrl: created.parentPageUrl,
          databases: Object.values(created.databases).map((database) => ({
            role: database.role,
            name: database.name,
            url: database.url,
          })),
          propertyMappingCounts: {
            meeting: created.propertyMappings.meeting.length,
            member: created.propertyMappings.member.length,
            task: created.propertyMappings.task.length,
          },
        },
      });
    } catch (error) {
      return this.result({
        ok: false,
        status: "failed",
        httpStatus: 400,
        messageKey: "setup.notion.managedDatabases.error.failed.message",
        userActionKey: "setup.notion.managedDatabases.error.failed.action",
        technicalDetail:
          error instanceof NotionApiError
            ? error.technicalDetail
            : errorMessage(error),
      });
    }
  }

  saveProjectName(body: unknown): SetupWizardActionResult {
    const name = readCleanString(body, ["name", "projectName"]);
    if (!name || name.length > 80) {
      return this.result({
        ok: false,
        status: "failed",
        httpStatus: 400,
        messageKey: "setup.project.name.error.invalid.message",
        userActionKey: "setup.project.name.error.invalid.action",
      });
    }

    const activeProject = this.readActiveProjectForSetup();
    if (!activeProject.ok) {
      return this.result(activeProject.error);
    }
    if (!activeProject.project || !this.options.projectStore) {
      return this.result({
        ok: false,
        status: "not_configured",
        httpStatus: 409,
        messageKey: "setup.project.name.error.missingProject.message",
        userActionKey: "setup.project.name.error.missingProject.action",
      });
    }

    const nowIso = this.now().toISOString();
    this.options.projectStore.updateProjectName({
      projectId: activeProject.project.id,
      name,
      nowIso,
    });
    this.options.projectStore.markProjectReady(activeProject.project.id, nowIso);

    return this.result({
      ok: true,
      status: "done",
      messageKey: "setup.project.name.save.done.message",
      userActionKey: "setup.project.name.save.done.action",
    });
  }

  private async testAiCli(
    settings: DirongLocalSettings,
  ): Promise<AiSetupTestResult> {
    const provider = settings.ai.provider ?? DEFAULT_SETUP_AI_SETTINGS.provider;
    const command = resolveAiCommand(settings.ai);
    if (!command) {
      throw new Error("AI CLI command is missing.");
    }
    return this.claudeTester.test({
      provider,
      mode: "cli",
      command,
      model: settings.ai.model ?? null,
    });
  }

  private async testClaudeApi(
    settings: DirongLocalSettings,
  ): Promise<AiSetupTestResult> {
    const apiKey = this.options.secretStore.get(
      settings.ai.apiKeySecretRef ?? DEFAULT_SECRET_REFS.claudeApiKey,
    );
    if (!apiKey) {
      throw new Error("Claude API key is missing.");
    }
    return this.claudeTester.test({
      provider: "claude",
      mode: "api",
      apiKey,
      model: settings.ai.model ?? null,
    });
  }

  private readActiveProjectForSetup():
    | { ok: true; project: DirongProjectRow | null }
    | { ok: false; error: ResultInput } {
    if (!this.options.projectStore) {
      return { ok: true, project: null };
    }

    const project = this.options.projectStore.getActiveProject();
    if (project) {
      return { ok: true, project };
    }

    return {
      ok: false,
      error: {
        ok: false,
        status: "not_configured",
        httpStatus: 409,
        messageKey: "setup.discord.guildAllowlist.error.invalid.message",
        userActionKey: "setup.discord.guildAllowlist.error.invalid.action",
      },
    };
  }

  private writeProjectCompatibilityProjection(input: {
    guildIds?: string[];
    notionTokenSecretRef?: string;
    notionParentPageUrl?: string;
    notionUploadMode?: DirongLocalSettings["notion"]["uploadMode"];
  }): void {
    this.options.settingsStore.update((settings) => ({
      ...settings,
      discord: input.guildIds
        ? {
            ...settings.discord,
            guildIds: input.guildIds,
          }
        : settings.discord,
      notion:
        input.notionTokenSecretRef ||
        input.notionParentPageUrl ||
        input.notionUploadMode
          ? {
              ...settings.notion,
              tokenSecretRef:
                input.notionTokenSecretRef ?? settings.notion.tokenSecretRef,
              parentPageUrl:
                input.notionParentPageUrl ?? settings.notion.parentPageUrl,
              uploadMode:
                input.notionUploadMode ?? settings.notion.uploadMode,
            }
          : settings.notion,
    }));
  }

  private readNotionContext():
    | {
        ok: true;
        projectId?: string;
        client: NotionClient;
        parentPageUrl: string;
        parentPageId: string;
      }
    | {
        ok: false;
        error: ResultInput;
      } {
    const settings = this.options.settingsStore.read();
    const activeProject = this.readActiveProjectForSetup();
    if (!activeProject.ok) {
      return {
        ok: false,
        error: activeProject.error,
      };
    }
    const notionTokenSecretRef = activeProject.project
      ? activeProject.project.notion_token_secret_ref
      : settings.notion.tokenSecretRef ?? DEFAULT_SECRET_REFS.notionToken;
    const parentPageUrl = activeProject.project
      ? activeProject.project.notion_parent_page_url
      : settings.notion.parentPageUrl;
    const token = this.options.secretStore.get(notionTokenSecretRef ?? undefined);
    if (!token || !parentPageUrl) {
      return {
        ok: false,
        error: {
          ok: false,
          status: "not_configured",
          httpStatus: 400,
          messageKey: "setup.notion.parentPage.verify.error.notConfigured.message",
          userActionKey: "setup.notion.parentPage.verify.error.notConfigured.action",
        },
      };
    }

    const parsed = parseNotionPageUrl(parentPageUrl);
    if (parsed.kind === "invalid") {
      return {
        ok: false,
        error: {
          ok: false,
          status: "failed",
          httpStatus: 400,
          messageKey: "setup.notion.parentPage.error.invalid.message",
          userActionKey: "setup.notion.parentPage.error.invalid.action",
          reason: parsed.reason,
        },
      };
    }

    return {
      ok: true,
      projectId: activeProject.project?.id,
      client: this.notionClientFactory(token),
      parentPageUrl,
      parentPageId: parsed.id,
    };
  }

  private buildState(): SetupWizardStateSnapshot {
    const settings = this.options.settingsStore.read();
    const setup = buildProductSetupStatus({
      paths: this.options.paths,
      settings,
      secretStore: this.options.secretStore,
      registryStore: this.options.registryStore,
      projectStore: this.options.projectStore,
    });
    const steps = buildWizardSteps(setup);
    const wizardComplete = steps.every((step) => step.status === "ready");
    const effectiveSetup: ProductSetupStatusSnapshot = wizardComplete
      ? setup
      : {
          ...setup,
          status: setup.status === "blocked" ? "blocked" : "not_configured",
        };
    const completedStepCount = steps.filter((step) => step.status === "ready").length;
    return {
      ...effectiveSetup,
      wizard: {
        currentStep:
          steps.find((step) => step.status === "current")?.id ?? "projectName",
        completedStepCount,
        totalStepCount: steps.length,
        inviteUrl: settings.discord.applicationId
          ? buildDiscordInviteUrl(settings.discord.applicationId)
          : null,
        steps,
      },
    };
  }

  private result(input: ResultInput): SetupWizardActionResult {
    const setup = this.buildState();
    const locale = setup.locale;
    const message = t(locale, input.messageKey);
    const userAction = input.userActionKey ? t(locale, input.userActionKey) : null;
    const runtimeEffect = input.runtimeEffectScope
      ? buildSettingsRuntimeEffect(locale, input.runtimeEffectScope)
      : undefined;
    const { runtimeEffectScope: _runtimeEffectScope, ...resultInput } = input;
    return {
      httpStatus: input.httpStatus ?? (input.ok ? 200 : 400),
      ...resultInput,
      message,
      userAction,
      ...(runtimeEffect ? { runtimeEffect } : {}),
      display: buildHumanStatusDisplay(locale, {
        ...wizardActionDisplayKeys(input.status),
        status: input.status,
        message,
        userAction,
        technicalDetail:
          typeof input.technicalDetail === "string" ? input.technicalDetail : null,
        messageKey: input.messageKey,
        userActionKey: input.userActionKey,
      }),
      setup,
    };
  }
}

type ResultInput = {
  ok: boolean;
  status: SetupWizardActionResult["status"];
  messageKey: LocaleKey;
  userActionKey: LocaleKey | null;
  httpStatus?: number;
  runtimeEffectScope?: SettingsRuntimeEffectScope;
  [key: string]: unknown;
};

function wizardActionDisplayKeys(
  status: SetupWizardActionResult["status"],
): Pick<
  HumanStatusDisplayInput,
  "titleKey" | "descriptionKey" | "nextActionKey"
> {
  if (status === "done") {
    return {
      titleKey: "statusDisplay.action.done.title",
      descriptionKey: "statusDisplay.action.done.description",
    };
  }
  if (status === "ready") {
    return {
      titleKey: "statusDisplay.action.ready.title",
      descriptionKey: "statusDisplay.action.ready.description",
    };
  }
  if (status === "blocked") {
    return {
      titleKey: "statusDisplay.action.blocked.title",
      descriptionKey: "statusDisplay.action.blocked.description",
      nextActionKey: "statusDisplay.action.blocked.nextAction",
    };
  }
  if (status === "not_configured") {
    return {
      titleKey: "statusDisplay.action.notConfigured.title",
      descriptionKey: "statusDisplay.action.notConfigured.description",
      nextActionKey: "statusDisplay.action.notConfigured.nextAction",
    };
  }
  return {
    titleKey: "statusDisplay.action.failed.title",
    descriptionKey: "statusDisplay.action.failed.description",
    nextActionKey: "statusDisplay.action.failed.nextAction",
  };
}

class DiscordJsSetupGateway implements DiscordSetupGateway {
  async testConnection(input: {
    botToken: string;
    applicationId: string;
  }): Promise<DiscordConnectionTestResult> {
    const client = await loginDiscordClient(input.botToken);
    try {
      const user = requireClientUser(client.user);
      if (user.id !== input.applicationId) {
        throw new Error(t("ko", "runtimeCli.setupGateway.applicationBotMismatch"));
      }
      return {
        botUserId: user.id,
        username: user.tag,
      };
    } finally {
      client.destroy();
    }
  }

  async listGuilds(input: { botToken: string }): Promise<SetupDiscordGuild[]> {
    const client = await loginDiscordClient(input.botToken);
    try {
      return client.guilds.cache.map((guild) => ({
        id: guild.id,
        name: guild.name,
        iconUrl: guild.iconURL(),
        owner: guild.ownerId === client.user?.id,
      }));
    } finally {
      client.destroy();
    }
  }
}

class DefaultClaudeSetupTester implements ClaudeSetupTester {
  async test(input:
    | {
        provider: AiProviderName;
        mode: "cli";
        command: string;
        model: string | null;
      }
    | {
        provider: "claude";
        mode: "api";
        apiKey: string;
        model: string | null;
      }): Promise<ClaudeSetupTestResult> {
    if (input.mode === "cli") {
      const result = await runChild(input.command, ["--version"], {
        timeoutMs: DEFAULT_AI_CLEANUP_SETTINGS.prepareTimeoutMs,
        maxStdoutBytes: 2000,
        maxStderrBytes: 2000,
      });
      if (result.timedOut || result.exitCode !== 0) {
        throw new Error(
          result.stderr || result.stdout || "Claude CLI preflight failed.",
        );
      }
      return {
        provider: input.provider,
        mode: "cli",
        model: input.model,
        detail: result.stdout.trim() || null,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      DEFAULT_AI_CLEANUP_SETTINGS.prepareTimeoutMs,
    );
    try {
      const response = await fetch("https://api.anthropic.com/v1/models?limit=1", {
        method: "GET",
        headers: {
          "x-api-key": input.apiKey,
          "anthropic-version": "2023-06-01",
        },
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(redactSensitiveText(text.slice(0, 500)));
      }
      return {
        provider: "claude",
        mode: "api",
        model: input.model,
        detail: null,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

async function loginDiscordClient(botToken: string): Promise<Client> {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const ready = new Promise<Client>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Discord bot login timed out."));
    }, 10000);
    client.once(Events.ClientReady, () => {
      clearTimeout(timer);
      resolve(client);
    });
  });
  try {
    await client.login(botToken);
    return await ready;
  } catch (error) {
    client.destroy();
    throw error;
  }
}

function requireClientUser(user: ClientUser | null): ClientUser {
  if (!user) {
    throw new Error(t("ko", "runtimeCli.setupGateway.botUserMissing"));
  }
  return user;
}

function createDefaultNotionClient(apiKey: string): NotionClient {
  return createNotionClient({
    apiKey,
    apiVersion: DEFAULT_NOTION_SETTINGS.apiVersion,
    baseUrl: DEFAULT_NOTION_SETTINGS.baseUrl,
    requestTimeoutMs: DEFAULT_NOTION_SETTINGS.requestTimeoutMs,
  });
}

function buildWizardSteps(
  setup: ProductSetupStatusSnapshot,
): SetupWizardStepSnapshot[] {
  const readiness: Record<SetupWizardStepId, boolean> = {
    language: isDirongLocale(setup.locale),
    discordApplication: setup.features.discord.applicationIdConfigured,
    discordBotToken: setup.secrets.discordBot.configured,
    discordGuild: setup.features.discord.guildAllowlistCount > 0,
    stt: setup.features.stt.status === "ready",
    ai: setup.features.ai.status === "ready",
    notionToken: setup.secrets.notion.configured,
    notionParentPage: setup.features.notion.parentPageConfigured,
    notionManagedDatabases: setup.features.notion.managedRegistryReady,
    projectName: isProjectNameConfigured(setup.projectSetup?.activeProject ?? null),
  };
  const ids: SetupWizardStepId[] = [
    "language",
    "discordApplication",
    "discordBotToken",
    "discordGuild",
    "stt",
    "ai",
    "notionToken",
    "notionParentPage",
    "notionManagedDatabases",
    "projectName",
  ];
  const firstIncomplete = ids.findIndex((id) => !readiness[id]);
  return ids.map((id, index) => ({
    id,
    status: readiness[id]
      ? "ready"
      : index === firstIncomplete
        ? "current"
        : "locked",
  }));
}

function isProjectNameConfigured(
  project: NonNullable<ProductSetupStatusSnapshot["projectSetup"]>["activeProject"] | null,
): boolean {
  if (!project) {
    return true;
  }
  const name = project.name.trim();
  if (!name) {
    return false;
  }
  if (project.id === DEFAULT_PROJECT_ID && name === "Default Project") {
    return false;
  }
  return name !== "Untitled Project" && name !== "Fresh Project";
}

function buildDiscordInviteUrl(applicationId: string): string {
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", applicationId);
  url.searchParams.set("permissions", "3146752");
  url.searchParams.set("scope", "bot applications.commands");
  return url.href;
}

function buildOpenAiSttSettings(
  body: unknown,
  currentSettings: DirongLocalSettings,
  model: string | null,
  language: string,
  timeoutMs: number,
):
  | {
      ok: true;
      stt: DirongLocalSettings["stt"];
      openAiApiKey: string | null;
    }
  | { ok: false; error: ResultInput } {
  const apiKey = readCleanString(body, ["apiKey", "openAiApiKey"]);
  const secretRef =
    apiKey || currentSettings.stt.openAiApiKeySecretRef
      ? DEFAULT_SECRET_REFS.openAiApiKey
      : undefined;
  return {
    ok: true,
    stt: {
      provider: "openai",
      language,
      timeoutMs,
      openAiApiKeySecretRef: secretRef,
      openAiModel: model ?? DEFAULT_STT_SETTINGS.openai.model,
    },
    openAiApiKey: apiKey,
  };
}

function hasFasterWhisperModelFiles(modelPath: string): boolean {
  return (
    existsSync(path.join(modelPath, "config.json")) &&
    existsSync(path.join(modelPath, "model.bin"))
  );
}

function buildLocalWhisperSettings(
  body: unknown,
  model: string | null,
  language: string,
  timeoutMs: number,
):
  | {
      ok: true;
      stt: DirongLocalSettings["stt"];
      openAiApiKey: null;
    }
  | { ok: false; error: ResultInput } {
  const profile = readLocalWhisperProfileInput(body);
  if (!profile.ok) {
    return profile;
  }
  const localWhisper: LocalWhisperLocalSettings = {
    profile: profile.profile,
    model: model ?? DEFAULT_STT_SETTINGS.localWhisper.model,
    device:
      readCleanString(body, ["device"]) ??
      DEFAULT_STT_SETTINGS.localWhisper.device,
    computeType:
      readCleanString(body, ["computeType"]) ??
      DEFAULT_STT_SETTINGS.localWhisper.computeType,
  };
  return {
    ok: true,
    stt: {
      provider: "local-whisper",
      language,
      timeoutMs,
      localWhisper,
    },
    openAiApiKey: null,
  };
}

function readLocalWhisperProfileInput(body: unknown):
  | { ok: true; profile: LocalWhisperToolProfile }
  | { ok: false; error: ResultInput } {
  const requestedProfile = readCleanString(body, [
    "profile",
    "toolProfile",
    "localWhisperProfile",
  ]);
  if (requestedProfile && !isLocalWhisperToolProfile(requestedProfile)) {
    return { ok: false, error: invalidSttCommandResult() };
  }

  const command = readCleanString(body, ["command"]);
  const args = readStringList(body, "args");
  const policy = validateDashboardCommandInput({ command });
  if (!policy.ok) {
    return { ok: false, error: invalidSttCommandResult() };
  }

  const profile = isLocalWhisperToolProfile(requestedProfile)
    ? requestedProfile
    : DEFAULT_LOCAL_WHISPER_TOOL_PROFILE;
  if (
    command &&
    !matchesLocalWhisperToolProfile({ command, args, profile })
  ) {
    return { ok: false, error: invalidSttCommandResult() };
  }

  return { ok: true, profile };
}

function readAiProviderInput(body: unknown): AiProviderName {
  const provider = readCleanString(body, ["provider", "aiProvider"]);
  return isAiProviderName(provider) ? provider : DEFAULT_SETUP_AI_SETTINGS.provider;
}

function readAiProfileInput(
  provider: AiProviderName,
  body: unknown,
):
  | { ok: true; profile: AiToolProfile }
  | { ok: false; error: ResultInput } {
  const requestedProfile = readCleanString(body, [
    "profile",
    "toolProfile",
    "aiProfile",
    `${provider}Profile`,
    "claudeProfile",
  ]);
  if (
    requestedProfile &&
    !isAiToolProfileForProvider(requestedProfile, provider)
  ) {
    return { ok: false, error: invalidClaudeCommandResult() };
  }

  const command = readCleanString(body, [
    `${provider}Command`,
    "aiCommand",
    "cliCommand",
    "claudeCommand",
    "command",
  ]);
  const policy = validateDashboardCommandInput({ command });
  if (!policy.ok) {
    return { ok: false, error: invalidClaudeCommandResult() };
  }

  const profile = isAiToolProfileForProvider(requestedProfile, provider)
    ? requestedProfile
    : defaultAiToolProfile(provider);
  if (command && !matchesAiToolProfile({ command, profile })) {
    return { ok: false, error: invalidClaudeCommandResult() };
  }

  return { ok: true, profile };
}

function readAiModelInput(
  provider: AiProviderName,
  body: unknown,
):
  | { ok: true; model: string | null }
  | { ok: false; error: ResultInput } {
  const model = readCleanString(body, ["model"]);
  if (!model) {
    return { ok: true, model: null };
  }
  const normalized = model.toLowerCase();
  if (provider === "claude" && isClaudeSetupModel(normalized)) {
    return { ok: true, model: normalized };
  }
  if (provider !== "claude" && isSafeTerminalModelName(model)) {
    return { ok: true, model };
  }
  return {
    ok: false,
    error: {
      ok: false,
      status: "failed",
      httpStatus: 400,
      messageKey: "setup.ai.claude.error.invalidModel.message",
      userActionKey: "setup.ai.claude.error.invalidModel.action",
    },
  };
}

function resolveAiSetupModel(
  provider: AiProviderName,
  value: string | null | undefined,
): string {
  if (!value) {
    return DEFAULT_SETUP_AI_MODEL_BY_PROVIDER[provider];
  }
  if (provider === "claude") {
    return isClaudeSetupModel(value)
      ? value
      : DEFAULT_SETUP_AI_MODEL_BY_PROVIDER.claude;
  }
  return isSafeTerminalModelName(value)
    ? value
    : DEFAULT_SETUP_AI_MODEL_BY_PROVIDER[provider];
}

function isClaudeSetupModel(value: string): value is ClaudeSetupModel {
  return SUPPORTED_CLAUDE_SETUP_MODELS.includes(value as ClaudeSetupModel);
}

function resolveAiCommand(settings: DirongLocalSettings["ai"]): string | null {
  if (settings.cliProfile) {
    return resolveAiToolProfile(settings.cliProfile).command;
  }
  if (settings.cliCommand) {
    return settings.cliCommand;
  }
  if (settings.provider && settings.provider !== "claude") {
    return resolveAiToolProfile(defaultAiToolProfile(settings.provider)).command;
  }
  if (settings.claudeProfile) {
    return resolveClaudeToolProfile(settings.claudeProfile).command;
  }
  return settings.claudeCommand ?? null;
}

function isSafeTerminalModelName(value: string): boolean {
  return value === "default" || (/^[A-Za-z0-9._:/-]+$/.test(value) && value.length <= 120);
}

function invalidSttCommandResult(): ResultInput {
  return {
    ok: false,
    status: "failed",
    httpStatus: 400,
    messageKey: "setup.stt.settings.error.invalidCommand.message",
    userActionKey: "setup.stt.settings.error.invalidCommand.action",
  };
}

function invalidClaudeCommandResult(): ResultInput {
  return {
    ok: false,
    status: "failed",
    httpStatus: 400,
    messageKey: "setup.ai.claude.error.invalidCommand.message",
    userActionKey: "setup.ai.claude.error.invalidCommand.action",
  };
}

function readCleanString(body: unknown, keys: readonly string[]): string | null {
  if (!isRecord(body)) {
    return null;
  }
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function readStringList(body: unknown, key: string): string[] {
  if (!isRecord(body)) {
    return [];
  }
  const value = body[key];
  if (!Array.isArray(value)) {
    return [];
  }
  const entries = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  return [...new Set(entries)];
}

function readPositiveInteger(body: unknown, key: string): number | null {
  if (!isRecord(body)) {
    return null;
  }
  const value = body[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const integer = Math.trunc(value);
  return integer > 0 ? integer : null;
}

function readBoolean(body: unknown, key: string): boolean | null {
  if (!isRecord(body)) {
    return null;
  }
  const value = body[key];
  return typeof value === "boolean" ? value : null;
}

function isDiscordSnowflake(value: string): boolean {
  return /^\d{15,25}$/.test(value);
}

function isCreatableNotionLocale(locale: DirongLocale): locale is NotionLocale {
  return CREATABLE_NOTION_SCHEMA_LOCALES.includes(
    locale as (typeof CREATABLE_NOTION_SCHEMA_LOCALES)[number],
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return redactSensitiveText(error instanceof Error ? error.message : String(error));
}
