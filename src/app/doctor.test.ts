import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("doctor tolerates legacy transcript_segments without speech_status", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-doctor-legacy-"));
  try {
    const dbPath = path.join(dir, "dirong.sqlite");
    createLegacyDbWithoutSpeechStatus(dbPath);
    const doctorPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "doctor.js",
    );

    const result = spawnSync(process.execPath, ["--no-warnings", doctorPath], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PHASE1_DB_PATH: dbPath,
        PHASE3_STT_PROVIDER: "openai",
        OPENAI_API_KEY: "doctor-test-key",
      },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /transcript segments:/);
    assert.doesNotMatch(result.stderr + result.stdout, /no such column/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createLegacyDbWithoutSpeechStatus(dbPath: string): void {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL
);

CREATE TABLE stt_jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL
);

CREATE TABLE transcript_segments (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL
);

CREATE TABLE repair_items (
  id INTEGER PRIMARY KEY,
  status TEXT NOT NULL
);
`);
  } finally {
    db.close();
  }
}
