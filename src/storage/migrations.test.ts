import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { applySchemaMigrations } from "./migrations.js";
import { DirongDatabase } from "./sqlite.js";

test("DirongDatabase upgrades legacy transcript_segments speech_status", () => {
  const fixture = createLegacyTranscriptFixture();
  try {
    const database = new DirongDatabase(fixture.dbPath, 1000);
    try {
      const columns = getColumnNames(database.db, "transcript_segments");
      assert.ok(columns.includes("speech_status"));
      assert.deepEqual(readTranscriptSpeechStatuses(database.db), [
        { id: "seg_empty", speech_status: "no_speech" },
        { id: "seg_speech", speech_status: "speech" },
      ]);
      assert.deepEqual(readMigrationIds(database.db), [
        "001_transcript_segments_speech_status",
      ]);
    } finally {
      database.close();
    }
  } finally {
    fixture.close();
  }
});

test("applySchemaMigrations is idempotent", () => {
  const fixture = createLegacyTranscriptFixture();
  try {
    const database = new DirongDatabase(fixture.dbPath, 1000);
    try {
      applySchemaMigrations(database.db);
      applySchemaMigrations(database.db);

      assert.deepEqual(readMigrationIds(database.db), [
        "001_transcript_segments_speech_status",
      ]);
    } finally {
      database.close();
    }
  } finally {
    fixture.close();
  }
});

test("DirongDatabase records migrations on a fresh baseline schema", () => {
  const fixture = createEmptyFixture();
  try {
    const database = new DirongDatabase(fixture.dbPath, 1000);
    try {
      assert.ok(getColumnNames(database.db, "dirong_migrations").includes("id"));
      assert.ok(
        getColumnNames(database.db, "transcript_segments").includes(
          "speech_status",
        ),
      );
      assert.deepEqual(readMigrationIds(database.db), [
        "001_transcript_segments_speech_status",
      ]);
    } finally {
      database.close();
    }
  } finally {
    fixture.close();
  }
});

function createLegacyTranscriptFixture(): {
  dbPath: string;
  close: () => void;
} {
  const fixture = createEmptyFixture();
  const db = new DatabaseSync(fixture.dbPath);
  try {
    db.exec(`
CREATE TABLE transcript_segments (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  stt_job_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  display_name_snapshot TEXT NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  text TEXT NOT NULL,
  source TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_audio_sha256 TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);
    const insert = db.prepare(`
INSERT INTO transcript_segments (
  id, session_id, chunk_id, stt_job_id, user_id, display_name_snapshot,
  start_ms, end_ms, text, source, provider, model, input_audio_sha256,
  created_at, updated_at
) VALUES (?, 'session', ?, ?, 'speaker', 'Taniar', 0, 1000, ?, 'real',
  'local-whisper', 'small', 'sha', '2026-05-07T00:00:00.000Z',
  '2026-05-07T00:00:00.000Z');
`);
    insert.run("seg_speech", "chunk_speech", "job_speech", "회의 발화");
    insert.run("seg_empty", "chunk_empty", "job_empty", "   ");
  } finally {
    db.close();
  }
  return fixture;
}

function createEmptyFixture(): {
  dbPath: string;
  close: () => void;
} {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-migrations-"));
  return {
    dbPath: path.join(dir, "dirong.sqlite"),
    close: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function getColumnNames(db: DatabaseSync, tableName: string): string[] {
  return (
    db.prepare(`PRAGMA table_info(${tableName});`).all() as Array<{
      name: string;
    }>
  ).map((column) => column.name);
}

function readMigrationIds(db: DatabaseSync): string[] {
  return (
    db.prepare("SELECT id FROM dirong_migrations ORDER BY id;").all() as Array<{
      id: string;
    }>
  ).map((row) => row.id);
}

function readTranscriptSpeechStatuses(
  db: DatabaseSync,
): Array<{ id: string; speech_status: string }> {
  return (
    db.prepare(
      "SELECT id, speech_status FROM transcript_segments ORDER BY id;",
    ).all() as Array<{ id: string; speech_status: string }>
  ).map((row) => ({
    id: row.id,
    speech_status: row.speech_status,
  }));
}
