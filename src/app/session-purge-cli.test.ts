import assert from "node:assert/strict";
import test from "node:test";
import { parseSessionPurgeArgs } from "./session-purge-cli.js";

test("parseSessionPurgeArgs defaults to dry-run for a selected session", () => {
  assert.deepEqual(parseSessionPurgeArgs(["--session", "meeting_1"]), {
    selector: { kind: "sessions", sessionIds: ["meeting_1"] },
    dryRun: true,
    backup: true,
    debug: false,
  });
});

test("parseSessionPurgeArgs accepts destructive missing-audio mode only with confirm", () => {
  assert.deepEqual(parseSessionPurgeArgs(["--missing-audio", "--confirm"]), {
    selector: { kind: "missing-audio" },
    dryRun: false,
    backup: true,
    debug: false,
  });
});

test("parseSessionPurgeArgs preserves dry-run when explicitly requested with confirm", () => {
  assert.deepEqual(
    parseSessionPurgeArgs(["--all", "--confirm", "--dry-run", "--no-backup", "--debug"]),
    {
      selector: { kind: "all" },
      dryRun: true,
      backup: false,
      debug: true,
    },
  );
});

test("parseSessionPurgeArgs accepts repeated session selectors", () => {
  assert.deepEqual(
    parseSessionPurgeArgs(["--session", "meeting_a", "--session", "meeting_b"]).selector,
    { kind: "sessions", sessionIds: ["meeting_a", "meeting_b"] },
  );
});

test("parseSessionPurgeArgs rejects missing, mixed, and unknown selectors", () => {
  assert.throws(() => parseSessionPurgeArgs([]), /정확히 하나/);
  assert.throws(
    () => parseSessionPurgeArgs(["--session", "meeting_1", "--all"]),
    /정확히 하나/,
  );
  assert.throws(
    () => parseSessionPurgeArgs(["--missing-audio", "--unexpected"]),
    /알 수 없는 session purge 옵션/,
  );
  assert.throws(() => parseSessionPurgeArgs(["--session"]), /--session 값/);
});
