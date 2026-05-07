import assert from "node:assert/strict";
import test from "node:test";
import { parsePhase3SttArgs } from "./phase3-stt-cli.js";

test("parsePhase3SttArgs defaults to safe small batch", () => {
  assert.deepEqual(parsePhase3SttArgs([]), {
    limit: 1,
    sessionId: null,
    dryRun: false,
    backup: true,
    provider: null,
    model: null,
    leaseMs: null,
    debug: false,
  });
});

test("parsePhase3SttArgs accepts local-whisper dry-run options", () => {
  assert.deepEqual(
    parsePhase3SttArgs([
      "--provider",
      "local-whisper",
      "--dry-run",
      "--limit",
      "3",
      "--session",
      "meeting_1",
      "--model",
      "small",
      "--lease-ms",
      "1000",
      "--no-backup",
      "--debug",
    ]),
    {
      limit: 3,
      sessionId: "meeting_1",
      dryRun: true,
      backup: false,
      provider: "local-whisper",
      model: "small",
      leaseMs: 1000,
      debug: true,
    },
  );
});

test("parsePhase3SttArgs rejects unknown providers", () => {
  assert.throws(
    () => parsePhase3SttArgs(["--provider", "bad"]),
    /local-whisper 또는 openai/,
  );
});

test("parsePhase3SttArgs rejects missing values", () => {
  assert.throws(() => parsePhase3SttArgs(["--session"]), /--session 값/);
  assert.throws(() => parsePhase3SttArgs(["--model"]), /--model 값/);
  assert.throws(() => parsePhase3SttArgs(["--provider"]), /local-whisper 또는 openai/);
});

test("parsePhase3SttArgs rejects invalid positive integers", () => {
  assert.throws(() => parsePhase3SttArgs(["--limit", "0"]), /1 이상의 정수/);
  assert.throws(() => parsePhase3SttArgs(["--limit", "-1"]), /1 이상의 정수/);
  assert.throws(() => parsePhase3SttArgs(["--lease-ms", "1.5"]), /1 이상의 정수/);
});

test("parsePhase3SttArgs preserves current duplicate value behavior", () => {
  assert.equal(parsePhase3SttArgs(["--limit", "2", "--limit", "4"]).limit, 4);
  assert.equal(
    parsePhase3SttArgs(["--session", "meeting_a", "--session", "meeting_b"])
      .sessionId,
    "meeting_b",
  );
});

test("parsePhase3SttArgs rejects unknown flags", () => {
  assert.throws(
    () => parsePhase3SttArgs(["--dry-run", "--unexpected"]),
    /알 수 없는 Phase 3 STT 옵션/,
  );
});
