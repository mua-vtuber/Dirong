import assert from "node:assert/strict";
import test from "node:test";
import { parsePhase5NotionUploadArgs } from "./phase5-notion-upload-cli.js";

test("parsePhase5NotionUploadArgs requires exactly one selector", () => {
  assert.throws(() => parsePhase5NotionUploadArgs([]), /정확히 하나/);
  assert.throws(
    () =>
      parsePhase5NotionUploadArgs([
        "--session",
        "session-1",
        "--draft",
        "draft-1",
      ]),
    /정확히 하나/,
  );
});

test("parsePhase5NotionUploadArgs accepts dry-run force and debug", () => {
  assert.deepEqual(
    parsePhase5NotionUploadArgs([
      "--draft",
      "draft-1",
      "--dry-run",
      "--force",
      "--debug",
    ]),
    {
      sessionId: null,
      draftId: "draft-1",
      dryRun: true,
      force: true,
      debug: true,
    },
  );
});

test("parsePhase5NotionUploadArgs rejects missing values and unknown flags", () => {
  assert.throws(() => parsePhase5NotionUploadArgs(["--draft"]), /--draft 값/);
  assert.throws(
    () => parsePhase5NotionUploadArgs(["--session", "s1", "--bad"]),
    /알 수 없는 Phase 5/,
  );
});
