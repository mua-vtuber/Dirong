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
