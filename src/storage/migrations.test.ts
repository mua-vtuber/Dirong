import assert from "node:assert/strict";
import {
  closeSync,
  mkdtempSync,
  openSync,
  readdirSync,
  rmSync,
} from "node:fs";
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
        "002_notion_writes",
        "003_notion_custom_property_rules",
      ]);
      assert.equal(tableExists(database.db, "notion_writes"), true);
      assert.equal(tableExists(database.db, "notion_blocks"), true);
      assert.equal(tableExists(database.db, "notion_custom_property_rules"), true);
    } finally {
      database.close();
    }
  } finally {
    fixture.close();
  }
});

test("DirongDatabase backs up existing DB before pending migrations", () => {
  const fixture = createLegacyTranscriptFixture();
  try {
    const database = new DirongDatabase(fixture.dbPath, 1000);
    database.close();

    const backupPath = findSingleBackupPath(fixture.dir);
    const backup = new DatabaseSync(backupPath, { readOnly: true });
    const migrated = new DatabaseSync(fixture.dbPath, { readOnly: true });
    try {
      assert.equal(
        getColumnNames(backup, "transcript_segments").includes("speech_status"),
        false,
      );
      assert.deepEqual(readMigrationIds(migrated), [
        "001_transcript_segments_speech_status",
        "002_notion_writes",
        "003_notion_custom_property_rules",
      ]);
    } finally {
      migrated.close();
      backup.close();
    }
  } finally {
    fixture.close();
  }
});

test("DirongDatabase aborts pending migrations when backup fails", () => {
  const fixture = createLegacyTranscriptFixture();
  const existingTarget = path.join(fixture.dir, "already-exists.sqlite");
  closeSync(openSync(existingTarget, "w"));
  try {
    assert.throws(
      () =>
        new DirongDatabase(fixture.dbPath, 1000, {
          migrationBackup: { targetPath: existingTarget },
        }),
      /SQLite backup target already exists/,
    );

    const database = new DatabaseSync(fixture.dbPath, { readOnly: true });
    try {
      assert.equal(
        getColumnNames(database, "transcript_segments").includes("speech_status"),
        false,
      );
      assert.equal(tableExists(database, "dirong_migrations"), false);
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
        "002_notion_writes",
        "003_notion_custom_property_rules",
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
        "002_notion_writes",
        "003_notion_custom_property_rules",
      ]);
      assert.ok(getColumnNames(database.db, "notion_writes").includes("draft_id"));
      assert.ok(getColumnNames(database.db, "notion_blocks").includes("block_index"));
      assert.ok(
        getColumnNames(database.db, "notion_custom_property_rules").includes(
          "prompt_description",
        ),
      );
    } finally {
      database.close();
    }
  } finally {
    fixture.close();
  }
});

test("DirongDatabase adds Phase 5 Notion tables to pre-Phase-5 databases", () => {
  const fixture = createPrePhase5Fixture();
  try {
    const database = new DirongDatabase(fixture.dbPath, 1000);
    try {
      assert.equal(tableExists(database.db, "notion_writes"), true);
      assert.equal(tableExists(database.db, "notion_blocks"), true);
      assert.equal(tableExists(database.db, "notion_custom_property_rules"), true);
      assert.deepEqual(readMigrationIds(database.db), [
        "001_transcript_segments_speech_status",
        "002_notion_writes",
        "003_notion_custom_property_rules",
      ]);
    } finally {
      database.close();
    }
  } finally {
    fixture.close();
  }
});

function createLegacyTranscriptFixture(): {
  dir: string;
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
  dir: string;
  dbPath: string;
  close: () => void;
} {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-migrations-"));
  return {
    dir,
    dbPath: path.join(dir, "dirong.sqlite"),
    close: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function createPrePhase5Fixture(): {
  dir: string;
  dbPath: string;
  close: () => void;
} {
  const fixture = createEmptyFixture();
  const db = new DatabaseSync(fixture.dbPath);
  try {
    db.exec(`
CREATE TABLE dirong_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

INSERT INTO dirong_migrations (id, applied_at)
VALUES ('001_transcript_segments_speech_status', '2026-05-07T00:00:00.000Z');

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  guild_name TEXT,
  text_channel_id TEXT,
  voice_channel_id TEXT NOT NULL,
  voice_channel_name TEXT,
  started_by_user_id TEXT NOT NULL,
  started_by_display_name TEXT,
  stopped_by_user_id TEXT,
  stopped_by_display_name TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  stopped_at TEXT,
  finalized_at TEXT,
  data_dir TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE ai_cleanup_jobs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  locked_by TEXT,
  locked_until TEXT,
  next_attempt_at TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  command TEXT,
  prompt_version TEXT NOT NULL,
  input_contract_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  input_entry_count INTEGER NOT NULL,
  input_timeline_json_path TEXT,
  input_timeline_markdown_path TEXT,
  prompt_path TEXT,
  raw_output_path TEXT,
  stderr_path TEXT,
  parsed_json_path TEXT,
  markdown_path TEXT,
  output_hash TEXT,
  failure_kind TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE meeting_notes_drafts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  ai_cleanup_job_id TEXT NOT NULL UNIQUE,
  schema_version TEXT NOT NULL,
  language TEXT NOT NULL,
  title TEXT NOT NULL,
  summary_text TEXT NOT NULL,
  draft_json TEXT NOT NULL,
  markdown TEXT NOT NULL,
  json_path TEXT NOT NULL,
  markdown_path TEXT NOT NULL,
  raw_output_path TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  output_hash TEXT NOT NULL,
  validation_status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);
  } finally {
    db.close();
  }
  return fixture;
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

function findSingleBackupPath(dir: string): string {
  const backupNames = readdirSync(dir).filter((name) =>
    name.startsWith("dirong.sqlite.backup-"),
  );
  assert.equal(backupNames.length, 1);
  return path.join(dir, backupNames[0] ?? "");
}

function tableExists(db: DatabaseSync, tableName: string): boolean {
  const row = db.prepare(
    "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?;",
  ).get(tableName) as { ok: number } | undefined;
  return row?.ok === 1;
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
