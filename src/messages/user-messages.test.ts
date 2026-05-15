import assert from "node:assert/strict";
import test from "node:test";
import { DirongError } from "../errors.js";
import { formatUserFacingError } from "./user-messages.js";

test("formatUserFacingError localizes dashboard port errors", () => {
  const error = new Error("listen EADDRINUSE 127.0.0.1:3095") as Error & {
    code: string;
  };
  error.code = "EADDRINUSE";

  assert.match(
    formatUserFacingError(error, "ko"),
    /디롱이 dashboard 포트를 이미 사용 중입니다: 127\.0\.0\.1:3095/,
  );
  assert.match(
    formatUserFacingError(error, "en"),
    /Dirong dashboard port is already in use: 127\.0\.0\.1:3095/,
  );
});

test("formatUserFacingError localizes local-whisper preflight guidance", () => {
  const error = new DirongError(
    "LOCAL_WHISPER_PREFLIGHT_FAILED",
    "local-whisper failed",
  );

  assert.match(
    formatUserFacingError(error, "ko"),
    /디롱이 local-whisper 준비에 실패했습니다/,
  );
  assert.match(
    formatUserFacingError(error, "en"),
    /Dirong could not prepare local-whisper/,
  );
});

test("formatUserFacingError localizes sqlite backup guidance", () => {
  const error = new DirongError("SQLITE_BACKUP_FAILED", "backup failed");

  assert.match(
    formatUserFacingError(error, "ko"),
    /디롱이 SQLite backup 생성에 실패했습니다/,
  );
  assert.match(
    formatUserFacingError(error, "en"),
    /Dirong could not create the SQLite backup/,
  );
});
