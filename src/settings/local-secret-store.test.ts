import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { redactSensitiveText } from "../errors.js";
import { LocalSecretStore } from "./local-secret-store.js";

test("LocalSecretStore stores values locally and exposes only presence snapshots", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-secrets-"));
  try {
    const store = new LocalSecretStore(path.join(dir, "secrets.json"));
    store.set("discord.bot_token", "discord-secret-raw-value", "2026-05-10T00:00:00.000Z");

    assert.equal(store.has("discord.bot_token"), true);
    assert.equal(store.get("discord.bot_token"), "discord-secret-raw-value");
    assert.deepEqual(store.snapshot("discord.bot_token"), {
      configured: true,
      displayValue: "[REDACTED]",
    });
    assert.equal(
      redactSensitiveText("failed with discord-secret-raw-value"),
      "failed with [REDACTED_SECRET]",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
