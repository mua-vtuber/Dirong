import assert from "node:assert/strict";
import test from "node:test";
import { createAiCleanupProviderFromSettings } from "./provider-factory.js";
import type { AiCleanupRuntimeSettings } from "../../settings/app-settings.js";

test("createAiCleanupProviderFromSettings creates Claude API provider for Claude API mode", () => {
  const provider = createAiCleanupProviderFromSettings({
    ...baseSettings(),
    provider: "claude",
    mode: "api",
    apiKey: "sk-ant-test",
    model: "opus",
    claudeModel: "opus",
  });

  assert.equal(provider.providerName, "claude-api");
  assert.equal(provider.modelName, "claude-opus-4-8");
});

test("createAiCleanupProviderFromSettings keeps Claude CLI provider for Claude CLI mode", () => {
  const provider = createAiCleanupProviderFromSettings({
    ...baseSettings(),
    provider: "claude",
    mode: "cli",
    command: "claude",
    claudeCommand: "claude",
    model: "haiku",
    claudeModel: "haiku",
  });

  assert.equal(provider.providerName, "claude-cli");
});

test("createAiCleanupProviderFromSettings creates a codex terminal CLI provider for codex settings", () => {
  const provider = createAiCleanupProviderFromSettings({
    ...baseSettings(),
    provider: "codex",
  });

  assert.equal(provider.providerName, "codex-cli");
});

test("createAiCleanupProviderFromSettings creates a gemini terminal CLI provider for gemini settings", () => {
  const provider = createAiCleanupProviderFromSettings({
    ...baseSettings(),
    provider: "gemini",
  });

  assert.equal(provider.providerName, "gemini-cli");
});

function baseSettings(): AiCleanupRuntimeSettings {
  return {
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
  };
}
