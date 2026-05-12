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

const EXPECTED_MIGRATION_IDS = [
  "001_transcript_segments_speech_status",
  "002_notion_writes",
  "003_notion_custom_property_rules",
  "004_notion_relation_property_rules",
  "005_notion_relation_target_pages",
  "006_notion_custom_property_value_source",
  "007_notion_registry",
  "008_notion_custom_property_rule_roles",
];

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
      assert.deepEqual(readMigrationIds(database.db), EXPECTED_MIGRATION_IDS);
      assert.equal(tableExists(database.db, "notion_writes"), true);
      assert.equal(tableExists(database.db, "notion_blocks"), true);
      assert.equal(tableExists(database.db, "notion_custom_property_rules"), true);
      assert.equal(tableExists(database.db, "notion_workspace_settings"), true);
      assert.equal(tableExists(database.db, "notion_managed_databases"), true);
      assert.equal(tableExists(database.db, "notion_property_mappings"), true);
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
      assert.deepEqual(readMigrationIds(migrated), EXPECTED_MIGRATION_IDS);
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

      assert.deepEqual(readMigrationIds(database.db), EXPECTED_MIGRATION_IDS);
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
      assert.deepEqual(readMigrationIds(database.db), EXPECTED_MIGRATION_IDS);
      assert.ok(getColumnNames(database.db, "notion_writes").includes("draft_id"));
      assert.ok(getColumnNames(database.db, "notion_blocks").includes("block_index"));
      assert.ok(
        getColumnNames(database.db, "notion_custom_property_rules").includes(
          "prompt_description",
        ),
      );
      assert.ok(
        getColumnNames(database.db, "notion_custom_property_rules").includes(
          "relation_target_url",
        ),
      );
      assert.ok(
        getColumnNames(database.db, "notion_custom_property_rules").includes(
          "relation_target_page_url",
        ),
      );
      assert.ok(
        getColumnNames(database.db, "notion_custom_property_rules").includes(
          "value_source",
        ),
      );
      assert.ok(
        getColumnNames(database.db, "notion_custom_property_rules").includes(
          "database_role",
        ),
      );
      assert.ok(
        getColumnNames(database.db, "notion_workspace_settings").includes(
          "parent_page_id",
        ),
      );
      assert.ok(
        getColumnNames(database.db, "notion_managed_databases").includes(
          "data_source_id",
        ),
      );
      assert.ok(
        getColumnNames(database.db, "notion_property_mappings").includes(
          "semantic_key",
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
      assert.deepEqual(readMigrationIds(database.db), EXPECTED_MIGRATION_IDS);
    } finally {
      database.close();
    }
  } finally {
    fixture.close();
  }
});

test("DirongDatabase adds Notion registry tables to pre-Phase-2 databases", () => {
  const fixture = createPrePhase2RegistryFixture();
  try {
    const database = new DirongDatabase(fixture.dbPath, 1000);
    try {
      assert.equal(tableExists(database.db, "notion_workspace_settings"), true);
      assert.equal(tableExists(database.db, "notion_managed_databases"), true);
      assert.equal(tableExists(database.db, "notion_property_mappings"), true);
      assert.deepEqual(readMigrationIds(database.db), EXPECTED_MIGRATION_IDS);
    } finally {
      database.close();
    }
  } finally {
    fixture.close();
  }
});

test("DirongDatabase migrates custom property rules into meeting role", () => {
  const fixture = createPreRoleCustomPropertyRulesFixture();
  try {
    const database = new DirongDatabase(fixture.dbPath, 1000);
    try {
      assert.ok(
        getColumnNames(database.db, "notion_custom_property_rules").includes(
          "database_role",
        ),
      );
      assert.deepEqual(readCustomPropertyRuleRoles(database.db), [
        {
          database_role: "meeting",
          property_name: "Discussion",
          property_type: "rich_text",
        },
      ]);
      assert.deepEqual(readMigrationIds(database.db), EXPECTED_MIGRATION_IDS);
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

function createPrePhase2RegistryFixture(): {
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
VALUES
  ('001_transcript_segments_speech_status', '2026-05-10T00:00:00.000Z'),
  ('002_notion_writes', '2026-05-10T00:00:00.000Z'),
  ('003_notion_custom_property_rules', '2026-05-10T00:00:00.000Z'),
  ('004_notion_relation_property_rules', '2026-05-10T00:00:00.000Z'),
  ('005_notion_relation_target_pages', '2026-05-10T00:00:00.000Z'),
  ('006_notion_custom_property_value_source', '2026-05-10T00:00:00.000Z');
`);
  } finally {
    db.close();
  }
  return fixture;
}

function createPreRoleCustomPropertyRulesFixture(): {
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
VALUES
  ('001_transcript_segments_speech_status', '2026-05-10T00:00:00.000Z'),
  ('002_notion_writes', '2026-05-10T00:00:00.000Z'),
  ('003_notion_custom_property_rules', '2026-05-10T00:00:00.000Z'),
  ('004_notion_relation_property_rules', '2026-05-10T00:00:00.000Z'),
  ('005_notion_relation_target_pages', '2026-05-10T00:00:00.000Z'),
  ('006_notion_custom_property_value_source', '2026-05-10T00:00:00.000Z'),
  ('007_notion_registry', '2026-05-10T00:00:00.000Z');

CREATE TABLE notion_custom_property_rules (
  property_name TEXT PRIMARY KEY,
  property_id TEXT,
  property_type TEXT NOT NULL,
  value_source TEXT NOT NULL DEFAULT 'ai',
  enabled INTEGER NOT NULL DEFAULT 0,
  prompt_description TEXT NOT NULL DEFAULT '',
  max_length INTEGER NOT NULL DEFAULT 1000,
  relation_target_url TEXT,
  relation_data_source_id TEXT,
  relation_target_page_url TEXT,
  relation_target_page_id TEXT,
  relation_match_property_name TEXT NOT NULL DEFAULT 'Name',
  relation_auto_create INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO notion_custom_property_rules (
  property_name, property_id, property_type, value_source, enabled,
  prompt_description, max_length, relation_match_property_name,
  relation_auto_create, created_at, updated_at
) VALUES (
  'Discussion', 'discussion-id', 'rich_text', 'ai', 1,
  '회의 논의 요약', 1000, 'Name', 0,
  '2026-05-10T00:00:00.000Z', '2026-05-10T00:00:00.000Z'
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

function readCustomPropertyRuleRoles(
  db: DatabaseSync,
): Array<{
  database_role: string;
  property_name: string;
  property_type: string;
}> {
  return (db.prepare(
    `SELECT database_role, property_name, property_type
     FROM notion_custom_property_rules
     ORDER BY database_role, property_name;`,
  ).all() as Array<{
    database_role: string;
    property_name: string;
    property_type: string;
  }>).map((row) => ({
    database_role: row.database_role,
    property_name: row.property_name,
    property_type: row.property_type,
  }));
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
