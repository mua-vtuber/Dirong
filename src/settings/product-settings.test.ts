import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  getDirongManagedPythonPath,
  getDirongUserDataPaths,
} from "./dirong-user-data.js";
import { LocalSecretStore, DEFAULT_SECRET_REFS } from "./local-secret-store.js";
import { LocalSettingsStore } from "./local-settings-store.js";
import {
  DEFAULT_DASHBOARD_SETTINGS,
  DEFAULT_RETENTION_SETTINGS,
  DEFAULT_SETUP_AI_SETTINGS,
  DEFAULT_STT_SETTINGS,
} from "./defaults.js";
import { NOTION_MANAGED_SCHEMA_VERSION } from "../notion/managed-schema.js";
import { NotionRegistryStore } from "../notion/registry-store.js";
import {
  buildProductSetupStatus,
  createProductNotionRuntimeSettingsProvider,
  createProductSetupStatusSource,
  loadProductRuntimeSettings,
} from "./product-settings.js";
import { SqlRunner } from "../storage/sql-runner.js";
import { DirongDatabase } from "../storage/sqlite.js";
import { ProjectStore } from "../projects/project-store.js";

test("loadProductRuntimeSettings ignores process env fallback for product Discord config", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-product-"));
  const previousToken = process.env.DISCORD_BOT_TOKEN;
  const previousClientId = process.env.DISCORD_CLIENT_ID;
  const previousGuildIds = process.env.DISCORD_GUILD_IDS;
  try {
    process.env.DISCORD_BOT_TOKEN = "env-token-must-not-be-used";
    process.env.DISCORD_CLIENT_ID = "env-client-must-not-be-used";
    process.env.DISCORD_GUILD_IDS = "env-guild-must-not-be-used";

    const runtime = loadProductRuntimeSettings({ userDataDir: dir });
    const status = runtime.setupStatus.getSnapshot();

    assert.equal(runtime.config.discordBotToken, "");
    assert.equal(runtime.config.discordClientId, "");
    assert.deepEqual(runtime.config.guildIds, []);
    assert.equal(status.status, "not_configured");
    assert.equal(status.features.discord.status, "not_configured");
  } finally {
    restoreEnv("DISCORD_BOT_TOKEN", previousToken);
    restoreEnv("DISCORD_CLIENT_ID", previousClientId);
    restoreEnv("DISCORD_GUILD_IDS", previousGuildIds);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadProductRuntimeSettings resolves product settings and secrets instead of process env", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-product-"));
  const envKeys = [
    "DISCORD_BOT_TOKEN",
    "DISCORD_CLIENT_ID",
    "DISCORD_GUILD_IDS",
    "PHASE3_STT_PROVIDER",
    "OPENAI_API_KEY",
    "PHASE3_STT_MODEL",
    "PHASE4_CLAUDE_COMMAND",
    "PHASE4_CLAUDE_MODEL",
    "NOTION_API_KEY",
    "NOTION_UPLOAD_MODE",
  ];
  const previous = new Map(envKeys.map((key) => [key, process.env[key]]));

  try {
    process.env.DISCORD_BOT_TOKEN = "env-discord-token-must-not-be-used";
    process.env.DISCORD_CLIENT_ID = "env-client-must-not-be-used";
    process.env.DISCORD_GUILD_IDS = "env-guild-must-not-be-used";
    process.env.PHASE3_STT_PROVIDER = "local-whisper";
    process.env.OPENAI_API_KEY = "env-openai-key-must-not-be-used";
    process.env.PHASE3_STT_MODEL = "env-stt-model-must-not-be-used";
    process.env.PHASE4_CLAUDE_COMMAND = "env-claude-must-not-be-used";
    process.env.PHASE4_CLAUDE_MODEL = "env-model-must-not-be-used";
    process.env.NOTION_API_KEY = "env-notion-token-must-not-be-used";
    process.env.NOTION_UPLOAD_MODE = "manual";

    const paths = getDirongUserDataPaths(dir);
    const settingsStore = new LocalSettingsStore(paths.settingsFile);
    const secretStore = new LocalSecretStore(paths.secretsFile);
    settingsStore.write({
      schemaVersion: 1,
      app: { locale: "ko" },
      discord: {
        applicationId: "product-client",
        botTokenSecretRef: DEFAULT_SECRET_REFS.discordBotToken,
        guildIds: ["product-guild"],
      },
      stt: {
        provider: "openai",
        openAiApiKeySecretRef: DEFAULT_SECRET_REFS.openAiApiKey,
        openAiModel: "product-stt-model",
      },
      ai: {
        provider: "claude",
        mode: "cli",
        claudeCommand: "product-claude",
        model: "product-ai-model",
      },
      notion: {
        tokenSecretRef: DEFAULT_SECRET_REFS.notionToken,
        parentPageUrl:
          "https://www.notion.so/workspace/Dirong-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        uploadMode: "automatic_after_ai_cleanup",
      },
      recording: { aloneFinalizeEnabled: true, aloneFinalizeGraceMs: 90000 },
      retention: { deleteAudioAfterNotionUpload: true, textDraftRetentionDays: 30 },
    });
    secretStore.set(DEFAULT_SECRET_REFS.discordBotToken, "product-discord-token");
    secretStore.set(DEFAULT_SECRET_REFS.openAiApiKey, "product-openai-key");
    secretStore.set(DEFAULT_SECRET_REFS.notionToken, "product-notion-token");

    const runtime = loadProductRuntimeSettings({ userDataDir: dir });

    assert.equal(runtime.config.discordBotToken, "product-discord-token");
    assert.equal(runtime.config.discordClientId, "product-client");
    assert.deepEqual(runtime.config.guildIds, ["product-guild"]);
    assert.equal(runtime.appSettings.stt.provider, "openai");
    if (runtime.appSettings.stt.provider !== "openai") {
      throw new Error("expected openai settings");
    }
    assert.equal(runtime.appSettings.stt.openai.apiKey, "product-openai-key");
    assert.equal(runtime.appSettings.stt.openai.model, "product-stt-model");
    assert.equal(runtime.appSettings.aiCleanup.provider, "claude");
    assert.equal(runtime.appSettings.aiCleanup.mode, "cli");
    assert.equal(runtime.appSettings.aiCleanup.command, "product-claude");
    assert.equal(runtime.appSettings.aiCleanup.model, "product-ai-model");
    assert.equal(runtime.appSettings.aiCleanup.apiKey, null);
    assert.equal(runtime.appSettings.aiCleanup.claudeCommand, "product-claude");
    assert.equal(runtime.appSettings.aiCleanup.claudeModel, "product-ai-model");
    assert.equal(runtime.appSettings.notion.enabled, true);
    assert.equal(runtime.appSettings.notion.apiKey, "product-notion-token");
    assert.equal(runtime.appSettings.notion.uploadMode, "automatic_after_ai_cleanup");
    const setup = runtime.setupStatus.getSnapshot();
    assert.equal(setup.editableSettings.stt.provider, "openai");
    assert.equal(setup.editableSettings.stt.openAiModel, "product-stt-model");
    assert.equal(setup.editableSettings.ai.mode, "cli");
    assert.equal(setup.editableSettings.ai.model, "product-ai-model");
    assert.equal(
      setup.editableSettings.notion.parentPageUrl,
      "https://www.notion.so/workspace/Dirong-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    assert.equal(setup.editableSettings.recording.aloneFinalizeGraceMs, 90000);

    const serialized = JSON.stringify(runtime);
    assert.doesNotMatch(serialized, /must-not-be-used/);
  } finally {
    for (const [key, value] of previous) {
      restoreEnv(key, value);
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildProductSetupStatus reports ready Discord without exposing token values", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-product-"));
  try {
    const paths = getDirongUserDataPaths(dir);
    const settingsStore = new LocalSettingsStore(paths.settingsFile);
    const secretStore = new LocalSecretStore(paths.secretsFile);
    settingsStore.write({
      schemaVersion: 1,
      app: { locale: "ko" },
      discord: {
        applicationId: "app-1",
        botTokenSecretRef: DEFAULT_SECRET_REFS.discordBotToken,
        guildIds: ["guild-1"],
      },
      stt: { provider: "local-whisper", localWhisper: { model: "small" } },
      ai: { provider: "claude", mode: "cli", claudeCommand: "claude" },
      notion: {},
      recording: { aloneFinalizeEnabled: true, aloneFinalizeGraceMs: 90000 },
      retention: { deleteAudioAfterNotionUpload: true, textDraftRetentionDays: 30 },
    });
    secretStore.set(DEFAULT_SECRET_REFS.discordBotToken, "discord-secret-raw-value");

    const status = buildProductSetupStatus({
      paths,
      settings: settingsStore.read(),
      secretStore,
    });
    const serialized = JSON.stringify(status);

    assert.equal(status.features.discord.status, "ready");
    assert.equal(status.features.discord.display?.title, "Discord 봇 연결이 준비됐어요");
    assert.equal(status.features.discord.runtimeEffect?.kind, "restart_required");
    assert.match(status.features.discord.runtimeEffect?.message ?? "", /자동 반영되지 않습니다/);
    assert.equal(status.secrets.discordBot.displayValue, "[REDACTED]");
    assert.doesNotMatch(serialized, /discord-secret-raw-value/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadProductRuntimeSettings resolves safe tool profiles to command templates", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-product-"));
  try {
    const paths = getDirongUserDataPaths(dir);
    const settingsStore = new LocalSettingsStore(paths.settingsFile);
    settingsStore.write({
      schemaVersion: 1,
      app: { locale: "ko" },
      discord: {},
      stt: {
        provider: "local-whisper",
        localWhisper: {
          profile: "local-whisper-python-script",
          model: "small",
        },
      },
      ai: {
        provider: "claude",
        mode: "cli",
        claudeProfile: "claude-cli-default",
      },
      notion: {},
      recording: { aloneFinalizeEnabled: true, aloneFinalizeGraceMs: 90000 },
      retention: { deleteAudioAfterNotionUpload: true, textDraftRetentionDays: 30 },
    });

    const runtime = loadProductRuntimeSettings({ userDataDir: dir });

    assert.equal(runtime.appSettings.stt.provider, "local-whisper");
    if (runtime.appSettings.stt.provider !== "local-whisper") {
      throw new Error("expected local-whisper settings");
    }
    assert.equal(runtime.appSettings.stt.localWhisper.command, "python");
    assert.deepEqual(runtime.appSettings.stt.localWhisper.args, [
      "scripts/local-whisper-json.py",
    ]);
    assert.equal(
      runtime.appSettings.stt.localWhisper.model,
      path.join(paths.modelsDir, "faster-whisper-small"),
    );
    assert.equal(runtime.appSettings.aiCleanup.provider, "claude");
    assert.equal(runtime.appSettings.aiCleanup.mode, "cli");
    assert.equal(runtime.appSettings.aiCleanup.command, "claude");
    assert.equal(runtime.appSettings.aiCleanup.apiKey, null);
    assert.equal(runtime.appSettings.aiCleanup.claudeCommand, "claude");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadProductRuntimeSettings resolves Claude API mode and secret for AI cleanup", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-product-"));
  try {
    const paths = getDirongUserDataPaths(dir);
    const settingsStore = new LocalSettingsStore(paths.settingsFile);
    const secretStore = new LocalSecretStore(paths.secretsFile);
    settingsStore.write({
      schemaVersion: 1,
      app: { locale: "ko" },
      discord: {},
      stt: {},
      ai: {
        provider: "claude",
        mode: "api",
        model: "sonnet",
        apiKeySecretRef: DEFAULT_SECRET_REFS.claudeApiKey,
      },
      notion: {},
      recording: { aloneFinalizeEnabled: true, aloneFinalizeGraceMs: 90000 },
      retention: { deleteAudioAfterNotionUpload: true, textDraftRetentionDays: 30 },
    });
    secretStore.set(DEFAULT_SECRET_REFS.claudeApiKey, "sk-ant-product");

    const runtime = loadProductRuntimeSettings({ userDataDir: dir });
    const status = runtime.setupStatus.getSnapshot();

    assert.equal(runtime.appSettings.aiCleanup.provider, "claude");
    assert.equal(runtime.appSettings.aiCleanup.mode, "api");
    assert.equal(runtime.appSettings.aiCleanup.model, "sonnet");
    assert.equal(runtime.appSettings.aiCleanup.apiKey, "sk-ant-product");
    assert.equal(runtime.appSettings.aiCleanup.claudeModel, "sonnet");
    assert.equal(status.features.ai.status, "ready");
    assert.equal(status.features.ai.mode, "api");
    assert.doesNotMatch(JSON.stringify(status), /sk-ant-product/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadProductRuntimeSettings resolves Codex and Gemini AI CLI profiles", () => {
  for (const [provider, profile, command] of [
    ["codex", "codex-cli-default", "codex"],
    ["gemini", "gemini-cli-default", "gemini"],
  ] as const) {
    const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-product-"));
    try {
      const paths = getDirongUserDataPaths(dir);
      const settingsStore = new LocalSettingsStore(paths.settingsFile);
      settingsStore.write({
        schemaVersion: 1,
        app: { locale: "ko" },
        discord: {},
        stt: {},
        ai: {
          provider,
          mode: "cli",
          cliProfile: profile,
          model: "default",
        },
        notion: {},
        recording: { aloneFinalizeEnabled: true, aloneFinalizeGraceMs: 90000 },
        retention: { deleteAudioAfterNotionUpload: true, textDraftRetentionDays: 30 },
      });

      const runtime = loadProductRuntimeSettings({ userDataDir: dir });

      assert.equal(runtime.appSettings.aiCleanup.provider, provider);
      assert.equal(runtime.appSettings.aiCleanup.command, command);
      assert.equal(runtime.appSettings.aiCleanup.model, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("loadProductRuntimeSettings prefers the managed local Whisper venv when present", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-product-"));
  try {
    const paths = getDirongUserDataPaths(dir);
    const settingsStore = new LocalSettingsStore(paths.settingsFile);
    const managedPython = getDirongManagedPythonPath(paths.root);
    mkdirSync(path.dirname(managedPython), { recursive: true });
    writeFileSync(managedPython, "");
    settingsStore.write({
      schemaVersion: 1,
      app: { locale: "ko" },
      discord: {},
      stt: {
        provider: "local-whisper",
        localWhisper: {
          profile: "local-whisper-python-script",
          model: "medium",
        },
      },
      ai: {},
      notion: {},
      recording: { aloneFinalizeEnabled: true, aloneFinalizeGraceMs: 90000 },
      retention: { deleteAudioAfterNotionUpload: true, textDraftRetentionDays: 30 },
    });

    const runtime = loadProductRuntimeSettings({ userDataDir: dir });

    assert.equal(runtime.appSettings.stt.provider, "local-whisper");
    if (runtime.appSettings.stt.provider !== "local-whisper") {
      throw new Error("expected local-whisper settings");
    }
    assert.equal(runtime.appSettings.stt.localWhisper.command, managedPython);
    assert.equal(
      runtime.appSettings.stt.localWhisper.model,
      path.join(paths.modelsDir, "faster-whisper-medium"),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildProductSetupStatus localizes setup messages and exposes locale keys", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-product-"));
  try {
    const paths = getDirongUserDataPaths(dir);
    const settingsStore = new LocalSettingsStore(paths.settingsFile);
    const secretStore = new LocalSecretStore(paths.secretsFile);
    settingsStore.write({
      schemaVersion: 1,
      app: { locale: "en" },
      discord: {},
      stt: {},
      ai: {},
      notion: {},
      recording: { aloneFinalizeEnabled: true, aloneFinalizeGraceMs: 90000 },
      retention: { deleteAudioAfterNotionUpload: true, textDraftRetentionDays: 30 },
    });

    const status = buildProductSetupStatus({
      paths,
      settings: settingsStore.read(),
      secretStore,
    });

    assert.equal(status.locale, "en");
    assert.equal(status.notionSchemaLocale, "en");
    assert.equal(status.dashboardTheme, "system");
    assert.deepEqual(status.defaults, {
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
      ai: DEFAULT_SETUP_AI_SETTINGS,
      retention: DEFAULT_RETENTION_SETTINGS,
      dashboard: {
        locale: DEFAULT_DASHBOARD_SETTINGS.locale,
        theme: DEFAULT_DASHBOARD_SETTINGS.theme,
        themes: DEFAULT_DASHBOARD_SETTINGS.themes,
      },
    });
    assert.equal(
      status.features.discord.messageKey,
      "setup.discord.status.notConfigured.message",
    );
    assert.equal(
      status.features.discord.message,
      "Discord bot connection setup is not complete yet.",
    );
    assert.equal(
      status.features.discord.userActionKey,
      "setup.discord.status.notConfigured.action",
    );
    assert.equal(
      status.features.discord.display?.title,
      "Discord bot connection is not finished yet",
    );
    assert.equal(status.features.stt.runtimeEffect?.kind, "restart_required");
    assert.match(
      status.features.stt.runtimeEffect?.message ?? "",
      /will not reload automatically/,
    );
    assert.match(
      status.features.discord.display?.details.find((detail) => detail.label === "message")?.value ?? "",
      /Discord bot connection setup is not complete yet/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ProductSetupStatusSource saves app locale through local settings", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-product-"));
  try {
    const paths = getDirongUserDataPaths(dir);
    const source = createProductSetupStatusSource({ paths });

    const status = source.setLocale("en");

    assert.equal(status.locale, "en");
    assert.equal(status.notionSchemaLocale, "en");
    assert.equal(new LocalSettingsStore(paths.settingsFile).read().app.locale, "en");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ProductSetupStatusSource saves dashboard theme through local settings", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-product-"));
  try {
    const paths = getDirongUserDataPaths(dir);
    const source = createProductSetupStatusSource({ paths });

    const status = source.setTheme("dark");

    assert.equal(status.dashboardTheme, "dark");
    assert.equal(new LocalSettingsStore(paths.settingsFile).read().app.dashboardTheme, "dark");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("createProductNotionRuntimeSettingsProvider reads latest Notion settings and secrets", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-product-"));
  try {
    const paths = getDirongUserDataPaths(dir);
    const settingsStore = new LocalSettingsStore(paths.settingsFile);
    const secretStore = new LocalSecretStore(paths.secretsFile);
    const getSettings = createProductNotionRuntimeSettingsProvider({ paths });

    assert.equal(getSettings().enabled, false);
    assert.equal(getSettings().apiKey, null);

    settingsStore.update((settings) => ({
      ...settings,
      notion: {
        tokenSecretRef: DEFAULT_SECRET_REFS.notionToken,
        parentPageUrl:
          "https://www.notion.so/workspace/Dirong-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        uploadMode: "automatic_after_ai_cleanup",
      },
    }));
    secretStore.set(DEFAULT_SECRET_REFS.notionToken, "ntn_test_dynamic_secret");

    const updated = getSettings();

    assert.equal(updated.enabled, true);
    assert.equal(updated.apiKey, "ntn_test_dynamic_secret");
    assert.equal(updated.uploadMode, "automatic_after_ai_cleanup");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("createProductNotionRuntimeSettingsProvider prefers the active project Notion settings", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-product-"));
  const database = new DirongDatabase(path.join(dir, "dirong.sqlite"), 1000);
  try {
    const paths = getDirongUserDataPaths(dir);
    const settingsStore = new LocalSettingsStore(paths.settingsFile);
    const secretStore = new LocalSecretStore(paths.secretsFile);
    const projectStore = new ProjectStore(new SqlRunner(database));
    settingsStore.update((settings) => ({
      ...settings,
      notion: {
        tokenSecretRef: DEFAULT_SECRET_REFS.notionToken,
        parentPageUrl:
          "https://www.notion.so/workspace/Legacy-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        uploadMode: "manual",
      },
    }));
    secretStore.set(DEFAULT_SECRET_REFS.notionToken, "legacy-notion-secret");
    projectStore.createReadyProject({
      id: "project-active",
      notionTokenSecretRef: "notion.project.project-active.token",
      notionParentPageUrl:
        "https://www.notion.so/workspace/Project-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      notionUploadMode: "automatic_after_ai_cleanup",
    });
    projectStore.setActiveProjectId("project-active");
    secretStore.set("notion.project.project-active.token", "project-notion-secret");

    const getSettings = createProductNotionRuntimeSettingsProvider({
      paths,
      projectStore,
    });
    const settings = getSettings();

    assert.equal(settings.enabled, true);
    assert.equal(settings.apiKey, "project-notion-secret");
    assert.equal(settings.uploadMode, "automatic_after_ai_cleanup");
  } finally {
    database.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildProductSetupStatus reports partial Notion registry as blocked", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-product-"));
  const database = new DirongDatabase(path.join(dir, "dirong.sqlite"), 1000);
  try {
    const paths = getDirongUserDataPaths(dir);
    const settingsStore = new LocalSettingsStore(paths.settingsFile);
    const secretStore = new LocalSecretStore(paths.secretsFile);
    const registryStore = new NotionRegistryStore(new SqlRunner(database));
    settingsStore.write({
      schemaVersion: 1,
      app: { locale: "ko" },
      discord: {},
      stt: {},
      ai: {},
      notion: {
        tokenSecretRef: DEFAULT_SECRET_REFS.notionToken,
        parentPageUrl:
          "https://www.notion.so/workspace/Dirong-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      recording: { aloneFinalizeEnabled: true, aloneFinalizeGraceMs: 90000 },
      retention: { deleteAudioAfterNotionUpload: true, textDraftRetentionDays: 30 },
    });
    secretStore.set(DEFAULT_SECRET_REFS.notionToken, "notion-secret-raw-value");
    registryStore.upsertManagedDatabase({
      role: "meeting",
      locale: "ko",
      databaseId: "meeting-db-id",
      dataSourceId: "meeting-ds-id",
      url: "https://notion.so/meeting",
      name: "회의록",
      createdByDirong: true,
      schemaVersion: NOTION_MANAGED_SCHEMA_VERSION,
      nowIso: "2026-05-10T00:00:00.000Z",
    });

    const status = buildProductSetupStatus({
      paths,
      settings: settingsStore.read(),
      secretStore,
      registryStore,
    });

    assert.equal(status.features.notion.status, "blocked");
    assert.equal(status.features.notion.managedRegistryReady, false);
    assert.equal(status.features.notion.managedRegistryStatus, "partial");
    assert.equal(
      status.features.notion.messageKey,
      "setup.notion.status.registryPartial.message",
    );
    assert.equal(
      status.features.notion.display?.title,
      "Notion DB 설정이 완성되지 않았어요",
    );
    assert.match(
      status.features.notion.display?.details.find((detail) => detail.label === "missing")?.value ?? "",
      /notion\.managedRegistry\.partial/,
    );
  } finally {
    database.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildProductSetupStatus projects Discord and Notion status from the active project", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-product-"));
  const database = new DirongDatabase(path.join(dir, "dirong.sqlite"), 1000);
  try {
    const paths = getDirongUserDataPaths(dir);
    const settingsStore = new LocalSettingsStore(paths.settingsFile);
    const secretStore = new LocalSecretStore(paths.secretsFile);
    const runner = new SqlRunner(database);
    const registryStore = new NotionRegistryStore(runner);
    const projectStore = new ProjectStore(runner);
    settingsStore.write({
      schemaVersion: 1,
      app: { locale: "ko" },
      discord: {
        applicationId: "app-1",
        botTokenSecretRef: DEFAULT_SECRET_REFS.discordBotToken,
        guildIds: ["legacy-guild"],
      },
      stt: {},
      ai: {},
      notion: {
        tokenSecretRef: DEFAULT_SECRET_REFS.notionToken,
        parentPageUrl:
          "https://www.notion.so/workspace/Legacy-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      recording: { aloneFinalizeEnabled: true, aloneFinalizeGraceMs: 90000 },
      retention: { deleteAudioAfterNotionUpload: true, textDraftRetentionDays: 30 },
    });
    secretStore.set(DEFAULT_SECRET_REFS.discordBotToken, "discord-secret");
    secretStore.set(DEFAULT_SECRET_REFS.notionToken, "legacy-notion-secret");
    projectStore.createReadyProject({
      id: "project-active",
      guildId: "project-guild",
      notionTokenSecretRef: "notion.project.project-active.token",
      notionParentPageUrl:
        "https://www.notion.so/workspace/Project-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      nowIso: "2026-05-13T00:00:00.000Z",
    });
    projectStore.setActiveProjectId("project-active");
    secretStore.set("notion.project.project-active.token", "project-notion-secret");
    registryStore.upsertManagedDatabase({
      projectId: "project-active",
      role: "meeting",
      locale: "ko",
      databaseId: "meeting-db-id",
      dataSourceId: "meeting-ds-id",
      url: "https://notion.so/meeting",
      name: "회의록",
      createdByDirong: true,
      schemaVersion: NOTION_MANAGED_SCHEMA_VERSION,
      nowIso: "2026-05-13T00:00:00.000Z",
    });

    const status = buildProductSetupStatus({
      paths,
      settings: settingsStore.read(),
      secretStore,
      registryStore,
      projectStore,
    });

    assert.equal(status.features.discord.status, "ready");
    assert.equal(status.features.discord.guildAllowlistCount, 1);
    assert.equal(status.projectSetup?.activeProject?.id, "project-active");
    assert.equal(status.projectSetup?.activeProject?.guildId, "project-guild");
    assert.equal(status.secrets.notion.configured, true);
    assert.equal(status.features.notion.managedRegistryStatus, "partial");
    assert.equal(status.features.notion.managedRegistry?.databaseCount, 1);
  } finally {
    database.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
