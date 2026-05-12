import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getDirongUserDataPaths } from "./dirong-user-data.js";
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
    assert.equal(runtime.appSettings.aiCleanup.claudeCommand, "claude");
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

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
