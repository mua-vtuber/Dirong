import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  loadAiCleanupSettingsFromEnv,
  loadSttSettingsFromEnv,
  splitCommandArgs,
} from "./env-settings-loader.js";

test("loadSttSettingsFromEnv defaults to local-whisper", () => {
  const settings = loadSttSettingsFromEnv({} as NodeJS.ProcessEnv);

  assert.equal(settings.provider, "local-whisper");
  assert.equal(settings.language, "ko");
  assert.equal(settings.timeoutMs, 120000);
  assert.equal(settings.localWhisper.command, "python");
  assert.deepEqual(settings.localWhisper.args, ["scripts/local-whisper-json.py"]);
  assert.equal(settings.localWhisper.model, "small");
  assert.equal(settings.localWhisper.device, "cpu");
  assert.equal(settings.localWhisper.computeType, "int8");
});

test("loadSttSettingsFromEnv loads openai settings only when selected", () => {
  const settings = loadSttSettingsFromEnv({
    PHASE3_STT_PROVIDER: "openai",
    OPENAI_API_KEY: "test-key",
    PHASE3_STT_MODEL: "whisper-1",
    PHASE3_STT_LANGUAGE: "ko",
    PHASE3_STT_TIMEOUT_MS: "30000",
  } as NodeJS.ProcessEnv);

  assert.equal(settings.provider, "openai");
  assert.equal(settings.openai.apiKey, "test-key");
  assert.equal(settings.openai.model, "whisper-1");
  assert.equal(settings.timeoutMs, 30000);
});

test("splitCommandArgs keeps quoted paths together", () => {
  assert.deepEqual(
    splitCommandArgs('python-wrapper "--with space/script.py" --flag'),
    ["python-wrapper", "--with space/script.py", "--flag"],
  );
});

test("loadAiCleanupSettingsFromEnv exposes Phase 4 runtime defaults", () => {
  const settings = loadAiCleanupSettingsFromEnv({} as NodeJS.ProcessEnv);

  assert.deepEqual(settings, {
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
  });
});

test("loadAiCleanupSettingsFromEnv reads Phase 4 runtime overrides", () => {
  const settings = loadAiCleanupSettingsFromEnv({
    PHASE4_CLAUDE_COMMAND: "claude-test",
    PHASE4_CLAUDE_MODEL: "haiku",
    PHASE4_AI_PREPARE_TIMEOUT_MS: "1000",
    PHASE4_AI_AUTO_CLEANUP_ENABLED: "false",
    PHASE4_AI_AUTO_CLEANUP_POLL_MS: "2000",
    PHASE4_AI_AUTO_CLEANUP_SESSION_BATCH_LIMIT: "4",
    PHASE4_AI_READINESS_RETRY_MS: "3000",
    PHASE4_AI_LEASE_MS: "4000",
    PHASE4_AI_MAX_ATTEMPTS: "5",
    PHASE4_AI_MAX_INPUT_CHARS: "6000",
    PHASE4_AI_TIMEOUT_MS: "7000",
    PHASE4_AI_MAX_OUTPUT_BYTES: "8000",
  } as NodeJS.ProcessEnv);

  assert.deepEqual(settings, {
    claudeCommand: "claude-test",
    claudeModel: "haiku",
    prepareTimeoutMs: 1000,
    autoCleanupEnabled: false,
    autoCleanupPollMs: 2000,
    autoCleanupSessionBatchLimit: 4,
    readinessRetryMs: 3000,
    leaseMs: 4000,
    maxAttempts: 5,
    maxInputChars: 6000,
    timeoutMs: 7000,
    maxOutputBytes: 8000,
  });
});

test("loadAiCleanupSettingsFromEnv can preserve main-app fallback behavior", () => {
  const invalidNumberKeys: Array<[string, number]> = [];
  const invalidOptionalKeys: string[] = [];

  const settings = loadAiCleanupSettingsFromEnv(
    {
      PHASE4_AI_AUTO_CLEANUP_POLL_MS: "bad",
      PHASE4_AI_LEASE_MS: "bad",
    } as NodeJS.ProcessEnv,
    {
      onInvalidPositiveInteger: (key, fallback) => {
        invalidNumberKeys.push([key, fallback]);
        return "fallback";
      },
      onInvalidOptionalPositiveInteger: (key) => {
        invalidOptionalKeys.push(key);
        return "null";
      },
    },
  );

  assert.equal(settings.autoCleanupPollMs, 5000);
  assert.equal(settings.leaseMs, null);
  assert.deepEqual(invalidNumberKeys, [["PHASE4_AI_AUTO_CLEANUP_POLL_MS", 5000]]);
  assert.deepEqual(invalidOptionalKeys, ["PHASE4_AI_LEASE_MS"]);
});

test("loadAiCleanupSettingsFromEnv throws invalid Phase 4 numbers by default", () => {
  assert.throws(
    () =>
      loadAiCleanupSettingsFromEnv({
        PHASE4_AI_MAX_ATTEMPTS: "bad",
      } as NodeJS.ProcessEnv),
    /PHASE4_AI_MAX_ATTEMPTS/,
  );
});

test(".env.example documents Phase 4 AI cleanup runtime keys", () => {
  const envExample = readFileSync(
    new URL("../../.env.example", import.meta.url),
    "utf8",
  );

  for (const key of [
    "PHASE4_CLAUDE_COMMAND",
    "PHASE4_CLAUDE_MODEL",
    "PHASE4_AI_PREPARE_TIMEOUT_MS",
    "PHASE4_AI_LEASE_MS",
    "PHASE4_AI_MAX_ATTEMPTS",
    "PHASE4_AI_MAX_INPUT_CHARS",
    "PHASE4_AI_TIMEOUT_MS",
    "PHASE4_AI_MAX_OUTPUT_BYTES",
    "PHASE4_AI_AUTO_CLEANUP_ENABLED",
    "PHASE4_AI_AUTO_CLEANUP_POLL_MS",
    "PHASE4_AI_AUTO_CLEANUP_SESSION_BATCH_LIMIT",
    "PHASE4_AI_READINESS_RETRY_MS",
  ]) {
    assert.match(envExample, new RegExp(`^${key}=`, "m"));
  }
});
