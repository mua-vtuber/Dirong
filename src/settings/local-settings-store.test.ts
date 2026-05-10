import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LocalSettingsStore } from "./local-settings-store.js";

test("LocalSettingsStore returns safe defaults when settings file is missing", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-settings-"));
  try {
    const store = new LocalSettingsStore(path.join(dir, "settings.json"));
    const settings = store.read();

    assert.equal(settings.app.locale, "ko");
    assert.equal(settings.recording.aloneFinalizeEnabled, true);
    assert.equal(settings.retention.textDraftRetentionDays, 30);
    assert.equal(settings.discord.applicationId, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("LocalSettingsStore ignores raw token-shaped fields outside the schema", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-settings-"));
  try {
    const settingsPath = path.join(dir, "settings.json");
    writeFileSync(
      settingsPath,
      JSON.stringify({
        discord: {
          applicationId: "app-1",
          botToken: "raw-token-should-not-be-modeled",
          botTokenSecretRef: "discord.bot_token",
          guildIds: ["guild-1", "guild-1", "guild-2"],
        },
        stt: {
          provider: "local-whisper",
          localWhisper: {
            model: "small",
          },
        },
      }),
    );

    const settings = new LocalSettingsStore(settingsPath).read();

    assert.equal("botToken" in settings.discord, false);
    assert.equal(settings.discord.botTokenSecretRef, "discord.bot_token");
    assert.deepEqual(settings.discord.guildIds, ["guild-1", "guild-2"]);
    assert.equal(settings.stt.localWhisper?.model, "small");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("LocalSettingsStore reads and persists the app locale", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-settings-"));
  try {
    const store = new LocalSettingsStore(path.join(dir, "settings.json"));
    const saved = store.update((settings) => ({
      ...settings,
      app: { ...settings.app, locale: "en" },
    }));

    assert.equal(saved.app.locale, "en");
    assert.equal(store.read().app.locale, "en");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("LocalSettingsStore falls back to Korean for unsupported locale values", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-settings-"));
  try {
    const settingsPath = path.join(dir, "settings.json");
    writeFileSync(settingsPath, JSON.stringify({ app: { locale: "jp" } }));

    assert.equal(new LocalSettingsStore(settingsPath).read().app.locale, "ko");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
