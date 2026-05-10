import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getDirongUserDataPaths } from "./dirong-user-data.js";
import { LocalSecretStore, DEFAULT_SECRET_REFS } from "./local-secret-store.js";
import { LocalSettingsStore } from "./local-settings-store.js";
import {
  buildProductSetupStatus,
  createProductSetupStatusSource,
  loadProductRuntimeSettings,
} from "./product-settings.js";

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
    assert.equal(status.secrets.discordBot.displayValue, "[REDACTED]");
    assert.doesNotMatch(serialized, /discord-secret-raw-value/);
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

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
