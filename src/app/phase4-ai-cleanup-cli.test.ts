import assert from "node:assert/strict";
import test from "node:test";
import { parsePhase4AiCleanupArgs } from "./phase4-ai-cleanup-cli.js";

test("parsePhase4AiCleanupArgs requires a session id", () => {
  assert.throws(() => parsePhase4AiCleanupArgs([]), /--session/);
});

test("parsePhase4AiCleanupArgs defaults to settings provider", () => {
  assert.equal(
    parsePhase4AiCleanupArgs(["--session", "meeting_1"]).provider,
    "settings",
  );
});

test("parsePhase4AiCleanupArgs accepts dry-run and fake provider options", () => {
  assert.deepEqual(
    parsePhase4AiCleanupArgs([
      "--session",
      "meeting_1",
      "--dry-run",
      "--provider",
      "fake",
      "--lease-ms",
      "1000",
      "--timeout-ms",
      "2000",
      "--max-input-chars",
      "3000",
      "--max-output-bytes",
      "4000",
      "--include-fake-stt",
      "--no-backup",
      "--debug",
    ]),
    {
      sessionId: "meeting_1",
      dryRun: true,
      backup: false,
      provider: "fake",
      model: null,
      leaseMs: 1000,
      timeoutMs: 2000,
      maxInputChars: 3000,
      maxOutputBytes: 4000,
      includeFakeStt: true,
      smokeTest: false,
      debug: true,
    },
  );
});

test("parsePhase4AiCleanupArgs accepts explicit fake STT smoke test", () => {
  assert.deepEqual(
    parsePhase4AiCleanupArgs([
      "--session",
      "meeting_1",
      "--provider",
      "fake",
      "--smoke-test",
      "--include-fake-stt",
    ]),
    {
      sessionId: "meeting_1",
      dryRun: false,
      backup: true,
      provider: "fake",
      model: null,
      leaseMs: null,
      timeoutMs: null,
      maxInputChars: null,
      maxOutputBytes: null,
      includeFakeStt: true,
      smokeTest: true,
      debug: false,
    },
  );
});

test("parsePhase4AiCleanupArgs accepts Claude provider model overrides", () => {
  assert.equal(
    parsePhase4AiCleanupArgs([
      "--session",
      "meeting_1",
      "--provider",
      "claude-cli",
      "--model",
      "sonnet",
    ]).model,
    "sonnet",
  );
  assert.equal(
    parsePhase4AiCleanupArgs([
      "--session",
      "meeting_1",
      "--provider",
      "claude-api",
      "--model",
      "sonnet",
    ]).provider,
    "claude-api",
  );
});

test("parsePhase4AiCleanupArgs accepts Codex and Gemini terminal providers", () => {
  assert.equal(
    parsePhase4AiCleanupArgs([
      "--session",
      "meeting_1",
      "--provider",
      "codex-cli",
    ]).provider,
    "codex-cli",
  );
  assert.equal(
    parsePhase4AiCleanupArgs([
      "--session",
      "meeting_1",
      "--provider",
      "gemini-cli",
    ]).provider,
    "gemini-cli",
  );
});

test("parsePhase4AiCleanupArgs rejects fake STT include in normal write mode", () => {
  assert.throws(
    () =>
      parsePhase4AiCleanupArgs([
        "--session",
        "meeting_1",
        "--provider",
        "fake",
        "--include-fake-stt",
      ]),
    /dry-run/,
  );
});

test("parsePhase4AiCleanupArgs rejects smoke test with real provider", () => {
  assert.throws(
    () =>
      parsePhase4AiCleanupArgs([
        "--session",
        "meeting_1",
        "--provider",
        "claude-cli",
        "--smoke-test",
      ]),
    /--provider fake/,
  );
});

test("parsePhase4AiCleanupArgs rejects unknown providers", () => {
  assert.throws(
    () =>
      parsePhase4AiCleanupArgs([
        "--session",
        "meeting_1",
        "--provider",
        "bad",
      ]),
    /claude-api.*codex-cli.*gemini-cli/,
  );
});

test("parsePhase4AiCleanupArgs rejects missing values", () => {
  assert.throws(
    () => parsePhase4AiCleanupArgs(["--session", "meeting_1", "--model"]),
    /--model 값/,
  );
  assert.throws(
    () => parsePhase4AiCleanupArgs(["--session", "meeting_1", "--provider"]),
    /claude-api.*codex-cli.*gemini-cli/,
  );
  assert.throws(() => parsePhase4AiCleanupArgs(["--session"]), /--session 값/);
});

test("parsePhase4AiCleanupArgs rejects invalid positive integers", () => {
  assert.throws(
    () => parsePhase4AiCleanupArgs(["--session", "meeting_1", "--lease-ms", "0"]),
    /1 이상의 정수/,
  );
  assert.throws(
    () =>
      parsePhase4AiCleanupArgs([
        "--session",
        "meeting_1",
        "--timeout-ms",
        "-1",
      ]),
    /1 이상의 정수/,
  );
  assert.throws(
    () =>
      parsePhase4AiCleanupArgs([
        "--session",
        "meeting_1",
        "--max-output-bytes",
        "1.5",
      ]),
    /1 이상의 정수/,
  );
});

test("parsePhase4AiCleanupArgs preserves current duplicate value behavior", () => {
  assert.equal(
    parsePhase4AiCleanupArgs([
      "--session",
      "meeting_a",
      "--session",
      "meeting_b",
    ]).sessionId,
    "meeting_b",
  );
  assert.equal(
    parsePhase4AiCleanupArgs([
      "--session",
      "meeting_1",
      "--provider",
      "fake",
      "--provider",
      "claude-cli",
    ]).provider,
    "claude-cli",
  );
});

test("parsePhase4AiCleanupArgs rejects unknown flags", () => {
  assert.throws(
    () => parsePhase4AiCleanupArgs(["--session", "meeting_1", "--unexpected"]),
    /알 수 없는 Phase 4 AI cleanup 옵션/,
  );
});
