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
import { SqlRunner } from "./sql-runner.js";
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
  "009_notion_member_roster_cache",
  "010_project_foundation",
  "011_project_foundation_hardening",
  "012_remove_default_members_custom_rule",
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
      assert.equal(tableExists(database.db, "notion_member_roster_entries"), true);
      assert.equal(tableExists(database.db, "notion_member_roster_syncs"), true);
      assert.equal(tableExists(database.db, "dirong_projects"), true);
      assert.equal(tableExists(database.db, "dirong_project_state"), true);
      assert.equal(tableExists(database.db, "notion_upload_scope"), true);
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
      applySchemaMigrations(new SqlRunner(database));
      applySchemaMigrations(new SqlRunner(database));

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
      assert.ok(
        getColumnNames(database.db, "notion_member_roster_entries").includes(
          "normalized_roles_json",
        ),
      );
      assert.ok(
        getColumnNames(database.db, "notion_member_roster_syncs").includes(
          "warnings_json",
        ),
      );
      assert.ok(getColumnNames(database.db, "sessions").includes("project_id"));
      assert.ok(
        getColumnNames(database.db, "notion_writes").includes("project_id"),
      );
      assert.ok(
        getColumnNames(database.db, "notion_workspace_settings").includes(
          "project_id",
        ),
      );
      assert.ok(
        getColumnNames(database.db, "notion_custom_property_rules").includes(
          "project_id",
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

test("DirongDatabase removes legacy meeting Members participant rule", () => {
  const fixture = createPreMembersRuleRemovalFixture();
  try {
    const database = new DirongDatabase(fixture.dbPath, 1000);
    try {
      assert.deepEqual(
        plainRows(database.db
          .prepare(
            `SELECT database_role, property_name, value_source
             FROM notion_custom_property_rules
             ORDER BY database_role, property_name`,
          )
          .all()),
        [
          {
            database_role: "meeting",
            property_name: "Attendees",
            value_source: "participants",
          },
          {
            database_role: "meeting",
            property_name: "Discussion",
            value_source: "ai",
          },
          {
            database_role: "member",
            property_name: "Members",
            value_source: "ai",
          },
        ],
      );
      assert.deepEqual(readMigrationIds(database.db), EXPECTED_MIGRATION_IDS);
    } finally {
      database.close();
    }
  } finally {
    fixture.close();
  }
});

test("DirongDatabase adds project foundation and backfills unambiguous legacy data", () => {
  const fixture = createPreProjectFoundationFixture({
    sessions: [
      { id: "session-1", guildId: "guild-a", guildName: "Guild A" },
      { id: "session-2", guildId: "guild-a", guildName: "Guild A" },
    ],
  });
  try {
    const database = new DirongDatabase(fixture.dbPath, 1000);
    try {
      assert.deepEqual(readMigrationIds(database.db), EXPECTED_MIGRATION_IDS);
      assert.deepEqual(
        plainRows(database.db
          .prepare(
            `SELECT id, lifecycle_status, guild_id, guild_name,
                    notion_parent_page_url, notion_upload_mode
             FROM dirong_projects
             ORDER BY id`,
          )
          .all()),
        [
          {
            id: "default",
            lifecycle_status: "ready",
            guild_id: "guild-a",
            guild_name: "Guild A",
            notion_parent_page_url: "https://notion.so/parent",
            notion_upload_mode: "automatic_after_ai_cleanup",
          },
        ],
      );
      assert.deepEqual(
        plainRows(database.db
          .prepare("SELECT id, active_project_id, switching FROM dirong_project_state")
          .all()),
        [{ id: "default", active_project_id: "default", switching: 0 }],
      );
      assert.deepEqual(
        plainRows(database.db
          .prepare(
            `SELECT project_id, automatic_upload_after, reset_mode, reset_at
             FROM notion_upload_scope`,
          )
          .all()),
        [
          {
            project_id: "default",
            automatic_upload_after: "1970-01-01T00:00:00.000Z",
            reset_mode: null,
            reset_at: null,
          },
        ],
      );
      assert.deepEqual(
        plainRows(database.db
          .prepare("SELECT id, project_id FROM sessions ORDER BY id")
          .all()),
        [
          { id: "session-1", project_id: "default" },
          { id: "session-2", project_id: "default" },
        ],
      );
      assertProjectScopedBackfill(database.db);
    } finally {
      database.close();
    }
  } finally {
    fixture.close();
  }
});

test("DirongDatabase leaves ambiguous legacy sessions without project backfill", () => {
  const fixture = createPreProjectFoundationFixture({
    sessions: [
      { id: "session-a", guildId: "guild-a", guildName: "Guild A" },
      { id: "session-b", guildId: "guild-b", guildName: "Guild B" },
    ],
    notionWriteStatus: "queued",
  });
  try {
    const database = new DirongDatabase(fixture.dbPath, 1000);
    try {
      assert.deepEqual(
        plainRow(database.db
          .prepare("SELECT guild_id FROM dirong_projects WHERE id = 'default'")
          .get()),
        { guild_id: null },
      );
      assert.deepEqual(
        plainRows(database.db
          .prepare("SELECT id, project_id FROM sessions ORDER BY id")
          .all()),
        [
          { id: "session-a", project_id: null },
          { id: "session-b", project_id: null },
        ],
      );
      assert.deepEqual(
        plainRows(database.db
          .prepare(
            `SELECT id, project_id, status, locked_by, locked_until
             FROM notion_writes
             ORDER BY id`,
          )
          .all()),
        [
          {
            id: "write-1",
            project_id: null,
            status: "blocked",
            locked_by: null,
            locked_until: null,
          },
        ],
      );
    } finally {
      database.close();
    }
  } finally {
    fixture.close();
  }
});

test("dirong_projects prevents duplicate non-archived guild ids", () => {
  const fixture = createEmptyFixture();
  try {
    const database = new DirongDatabase(fixture.dbPath, 1000);
    try {
      const nowIso = "2026-05-13T00:00:00.000Z";
      database.db
        .prepare(
          `INSERT INTO dirong_projects (
             id, name, lifecycle_status, guild_id, command_enabled,
             notion_upload_mode, created_at, updated_at
           ) VALUES (?, ?, 'ready', ?, 1, 'manual', ?, ?)`,
        )
        .run("project-a", "A", "guild-duplicate", nowIso, nowIso);
      assert.throws(
        () =>
          database.db
            .prepare(
              `INSERT INTO dirong_projects (
                 id, name, lifecycle_status, guild_id, command_enabled,
                 notion_upload_mode, created_at, updated_at
               ) VALUES (?, ?, 'ready', ?, 1, 'manual', ?, ?)`,
            )
            .run("project-b", "B", "guild-duplicate", nowIso, nowIso),
        /UNIQUE constraint failed/,
      );
      database.db
        .prepare("UPDATE dirong_projects SET archived_at = ? WHERE id = ?")
        .run(nowIso, "project-a");
      database.db
        .prepare(
          `INSERT INTO dirong_projects (
             id, name, lifecycle_status, guild_id, command_enabled,
             notion_upload_mode, created_at, updated_at
           ) VALUES (?, ?, 'ready', ?, 1, 'manual', ?, ?)`,
        )
        .run("project-b", "B", "guild-duplicate", nowIso, nowIso);
    } finally {
      database.close();
    }
  } finally {
    fixture.close();
  }
});

test("DirongDatabase hardens previously migrated ambiguous legacy Notion writes", () => {
  const fixture = createPostProjectFoundationAmbiguousWriteFixture();
  try {
    const database = new DirongDatabase(fixture.dbPath, 1000);
    try {
      assert.deepEqual(readMigrationIds(database.db), EXPECTED_MIGRATION_IDS);
      assert.deepEqual(
        plainRows(database.db
          .prepare(
            `SELECT id, project_id, status, status_message, locked_by, locked_until
             FROM notion_writes
             ORDER BY id`,
          )
          .all()),
        [
          {
            id: "write-forced-default",
            project_id: null,
            status: "blocked",
            status_message:
              "Blocked because the legacy session project is ambiguous.",
            locked_by: null,
            locked_until: null,
          },
        ],
      );
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

function createPreMembersRuleRemovalFixture(): {
  dir: string;
  dbPath: string;
  close: () => void;
} {
  const fixture = createEmptyFixture();
  const baseline = new DirongDatabase(fixture.dbPath, 1000);
  baseline.close();

  const db = new DatabaseSync(fixture.dbPath);
  try {
    db.exec(`
DELETE FROM dirong_migrations
WHERE id = '012_remove_default_members_custom_rule';

INSERT INTO notion_custom_property_rules (
  project_id, database_role, property_name, property_id, property_type,
  value_source, enabled, prompt_description, max_length, relation_target_url,
  relation_data_source_id, relation_target_page_url, relation_target_page_id,
  relation_match_property_name, relation_auto_create, last_seen_at,
  created_at, updated_at
) VALUES
  (
    'default', 'meeting', 'Members', 'members-id', 'relation',
    'participants', 1, '', 1000, 'https://www.notion.so/members',
    'members-data-source', NULL, NULL, 'Name', 1, NULL,
    '2026-05-14T00:00:00.000Z', '2026-05-14T00:00:00.000Z'
  ),
  (
    'default', 'meeting', 'Attendees', 'attendees-id', 'relation',
    'participants', 1, '', 1000, 'https://www.notion.so/attendees',
    'attendees-data-source', NULL, NULL, 'Name', 1, NULL,
    '2026-05-14T00:00:00.000Z', '2026-05-14T00:00:00.000Z'
  ),
  (
    'default', 'meeting', 'Discussion', 'discussion-id', 'rich_text',
    'ai', 1, '회의 논의 요약', 1000, NULL,
    NULL, NULL, NULL, 'Name', 0, NULL,
    '2026-05-14T00:00:00.000Z', '2026-05-14T00:00:00.000Z'
  ),
  (
    'default', 'member', 'Members', 'member-members-id', 'rich_text',
    'ai', 1, '작업자 메모', 1000, NULL,
    NULL, NULL, NULL, 'Name', 0, NULL,
    '2026-05-14T00:00:00.000Z', '2026-05-14T00:00:00.000Z'
  );
`);
  } finally {
    db.close();
  }
  return fixture;
}

function createPreProjectFoundationFixture(input: {
  sessions: Array<{ id: string; guildId: string; guildName: string }>;
  notionWriteStatus?: "done" | "queued";
}): {
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
  ('007_notion_registry', '2026-05-10T00:00:00.000Z'),
  ('008_notion_custom_property_rule_roles', '2026-05-10T00:00:00.000Z'),
  ('009_notion_member_roster_cache', '2026-05-10T00:00:00.000Z');

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

CREATE TABLE notion_workspace_settings (
  id TEXT PRIMARY KEY,
  locale TEXT NOT NULL,
  parent_page_url TEXT NOT NULL,
  parent_page_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE notion_managed_databases (
  role TEXT PRIMARY KEY,
  locale TEXT NOT NULL,
  database_id TEXT NOT NULL,
  data_source_id TEXT NOT NULL,
  url TEXT NOT NULL,
  name TEXT NOT NULL,
  created_by_dirong INTEGER NOT NULL DEFAULT 1,
  schema_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE notion_property_mappings (
  database_role TEXT NOT NULL,
  semantic_key TEXT NOT NULL,
  property_name TEXT NOT NULL,
  property_id TEXT,
  property_type TEXT NOT NULL,
  locked INTEGER NOT NULL DEFAULT 1,
  source_kind TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (database_role, semantic_key)
);

CREATE TABLE notion_custom_property_rules (
  database_role TEXT NOT NULL DEFAULT 'meeting',
  property_name TEXT NOT NULL,
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
  updated_at TEXT NOT NULL,
  PRIMARY KEY (database_role, property_name)
);

CREATE TABLE notion_writes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_url TEXT NOT NULL,
  notion_page_id TEXT,
  notion_page_url TEXT,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  status_message TEXT,
  last_successful_block_index INTEGER NOT NULL DEFAULT -1,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  locked_by TEXT,
  locked_until TEXT,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (draft_id, target_type, target_id)
);

CREATE TABLE notion_blocks (
  notion_write_id TEXT NOT NULL,
  block_index INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  notion_block_id TEXT,
  status TEXT NOT NULL,
  appended_at TEXT,
  last_error TEXT,
  PRIMARY KEY (notion_write_id, block_index)
);

CREATE TABLE notion_member_roster_entries (
  page_id TEXT PRIMARY KEY,
  data_source_id TEXT NOT NULL,
  discord_name TEXT NOT NULL,
  normalized_discord_name TEXT NOT NULL,
  organization TEXT,
  roles_json TEXT NOT NULL,
  normalized_roles_json TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  raw_updated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE notion_member_roster_syncs (
  data_source_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  synced_at TEXT,
  member_count INTEGER NOT NULL DEFAULT 0,
  warning_count INTEGER NOT NULL DEFAULT 0,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);

    const insertSession = db.prepare(`
INSERT INTO sessions (
  id, guild_id, guild_name, text_channel_id, voice_channel_id,
  voice_channel_name, started_by_user_id, started_by_display_name, status,
  started_at, data_dir, created_at, updated_at
) VALUES (?, ?, ?, 'text', 'voice', 'Voice', 'starter', 'Taniar',
  'finalized', '2026-05-10T00:00:00.000Z', ?, '2026-05-10T00:00:00.000Z',
  '2026-05-10T00:00:00.000Z');
`);
    for (const session of input.sessions) {
      insertSession.run(
        session.id,
        session.guildId,
        session.guildName,
        path.join(fixture.dir, session.id),
      );
    }

    db.exec(`
INSERT INTO ai_cleanup_jobs (
  id, session_id, status, next_attempt_at, provider, model, prompt_version,
  input_contract_version, input_hash, input_entry_count, created_at, updated_at
) VALUES (
  'ai-job-1', '${input.sessions[0]?.id ?? "session-1"}', 'done',
  '2026-05-10T00:00:00.000Z', 'fake', 'model', 'prompt-v1', 'contract-v1',
  'input-hash', 1, '2026-05-10T00:00:00.000Z', '2026-05-10T00:00:00.000Z'
);

INSERT INTO meeting_notes_drafts (
  id, session_id, ai_cleanup_job_id, schema_version, language, title,
  summary_text, draft_json, markdown, json_path, markdown_path,
  raw_output_path, provider, model, prompt_version, input_hash, output_hash,
  validation_status, created_at, updated_at
) VALUES (
  'draft-1', '${input.sessions[0]?.id ?? "session-1"}', 'ai-job-1', 'v1',
  'ko', '회의록', '요약', '{}', '# 회의록', 'draft.json', 'draft.md',
  'raw.txt', 'fake', 'model', 'prompt-v1', 'input-hash', 'output-hash',
  'valid', '2026-05-10T00:00:00.000Z', '2026-05-10T00:00:00.000Z'
);

INSERT INTO notion_workspace_settings (
  id, locale, parent_page_url, parent_page_id, created_at, updated_at
) VALUES (
  'default', 'ko', 'https://notion.so/parent', 'parent-id',
  '2026-05-10T00:00:00.000Z', '2026-05-10T00:00:00.000Z'
);

INSERT INTO notion_managed_databases (
  role, locale, database_id, data_source_id, url, name, created_by_dirong,
  schema_version, created_at, updated_at
) VALUES (
  'meeting', 'ko', 'database-id', 'data-source-id',
  'https://notion.so/database', 'Meetings', 1, 'v1',
  '2026-05-10T00:00:00.000Z', '2026-05-10T00:00:00.000Z'
);

INSERT INTO notion_property_mappings (
  database_role, semantic_key, property_name, property_id, property_type,
  locked, source_kind, created_at, updated_at
) VALUES (
  'meeting', 'meeting.title', 'Name', 'title-id', 'title', 1, 'system',
  '2026-05-10T00:00:00.000Z', '2026-05-10T00:00:00.000Z'
);

INSERT INTO notion_custom_property_rules (
  database_role, property_name, property_id, property_type, value_source,
  enabled, prompt_description, max_length, relation_match_property_name,
  relation_auto_create, created_at, updated_at
) VALUES (
  'meeting', 'Mood', 'mood-id', 'select', 'ai', 1, '회의 분위기',
  1000, 'Name', 0, '2026-05-10T00:00:00.000Z',
  '2026-05-10T00:00:00.000Z'
);

INSERT INTO notion_writes (
  id, session_id, draft_id, target_type, target_id, target_url, content_hash,
  status, status_message, next_attempt_at, created_at, updated_at
) VALUES (
  'write-1', '${input.sessions[0]?.id ?? "session-1"}', 'draft-1',
  'data_source', 'data-source-id', 'https://notion.so/database', 'hash',
  '${input.notionWriteStatus ?? "done"}', '${input.notionWriteStatus ?? "done"}',
  '2026-05-10T00:00:00.000Z',
  '2026-05-10T00:00:00.000Z', '2026-05-10T00:00:00.000Z'
);

INSERT INTO notion_blocks (
  notion_write_id, block_index, content_hash, notion_block_id, status,
  appended_at, last_error
) VALUES (
  'write-1', 0, 'block-hash', 'block-id', 'appended',
  '2026-05-10T00:00:00.000Z', NULL
);

INSERT INTO notion_member_roster_entries (
  page_id, data_source_id, discord_name, normalized_discord_name,
  organization, roles_json, normalized_roles_json, synced_at, raw_updated_at,
  created_at, updated_at
) VALUES (
  'member-page-1', 'member-source', 'Taniar', 'taniar', 'Dirong',
  '["Lead"]', '["lead"]', '2026-05-10T00:00:00.000Z', NULL,
  '2026-05-10T00:00:00.000Z', '2026-05-10T00:00:00.000Z'
);

INSERT INTO notion_member_roster_syncs (
  data_source_id, status, synced_at, member_count, warning_count,
  warnings_json, last_error, created_at, updated_at
) VALUES (
  'member-source', 'done', '2026-05-10T00:00:00.000Z', 1, 0,
  '[]', NULL, '2026-05-10T00:00:00.000Z',
  '2026-05-10T00:00:00.000Z'
);
`);
  } finally {
    db.close();
  }
  return fixture;
}

function createPostProjectFoundationAmbiguousWriteFixture(): {
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
  ('007_notion_registry', '2026-05-10T00:00:00.000Z'),
  ('008_notion_custom_property_rule_roles', '2026-05-10T00:00:00.000Z'),
  ('009_notion_member_roster_cache', '2026-05-10T00:00:00.000Z'),
  ('010_project_foundation', '2026-05-10T00:00:00.000Z');

CREATE TABLE dirong_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL,
  guild_id TEXT,
  guild_name TEXT,
  guild_icon_url TEXT,
  command_enabled INTEGER NOT NULL DEFAULT 1,
  notion_token_secret_ref TEXT,
  notion_parent_page_url TEXT,
  notion_upload_mode TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

INSERT INTO dirong_projects (
  id, name, lifecycle_status, command_enabled, notion_upload_mode,
  created_at, updated_at
) VALUES (
  'default', 'Default Project', 'ready', 1, 'manual',
  '2026-05-10T00:00:00.000Z', '2026-05-10T00:00:00.000Z'
);

CREATE TABLE dirong_project_state (
  id TEXT PRIMARY KEY,
  active_project_id TEXT,
  switching INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

INSERT INTO dirong_project_state (
  id, active_project_id, switching, updated_at
) VALUES (
  'default', 'default', 0, '2026-05-10T00:00:00.000Z'
);

CREATE TABLE notion_upload_scope (
  project_id TEXT PRIMARY KEY,
  automatic_upload_after TEXT NOT NULL,
  reset_mode TEXT,
  reset_at TEXT,
  updated_at TEXT NOT NULL
);

INSERT INTO notion_upload_scope (
  project_id, automatic_upload_after, reset_mode, reset_at, updated_at
) VALUES (
  'default', '1970-01-01T00:00:00.000Z', NULL, NULL,
  '2026-05-10T00:00:00.000Z'
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT,
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

INSERT INTO sessions (
  id, project_id, guild_id, guild_name, text_channel_id, voice_channel_id,
  voice_channel_name, started_by_user_id, started_by_display_name, status,
  started_at, finalized_at, data_dir, created_at, updated_at
) VALUES (
  'ambiguous-session', NULL, 'guild-b', 'Guild B', 'text', 'voice',
  'Voice', 'starter', 'Taniar', 'finalized',
  '2026-05-10T00:00:00.000Z', '2026-05-10T00:00:00.000Z',
  'session-dir', '2026-05-10T00:00:00.000Z',
  '2026-05-10T00:00:00.000Z'
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

CREATE TABLE notion_writes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL DEFAULT 'default',
  session_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type = 'data_source'),
  target_id TEXT NOT NULL,
  target_url TEXT NOT NULL,
  notion_page_id TEXT,
  notion_page_url TEXT,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  status_message TEXT,
  last_successful_block_index INTEGER NOT NULL DEFAULT -1,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  locked_by TEXT,
  locked_until TEXT,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (draft_id, project_id, target_type, target_id)
);

CREATE TABLE notion_blocks (
  notion_write_id TEXT NOT NULL,
  block_index INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  notion_block_id TEXT,
  status TEXT NOT NULL,
  appended_at TEXT,
  last_error TEXT,
  PRIMARY KEY (notion_write_id, block_index)
);

INSERT INTO ai_cleanup_jobs (
  id, session_id, status, next_attempt_at, provider, model, prompt_version,
  input_contract_version, input_hash, input_entry_count, created_at, updated_at
) VALUES (
  'ai-job-ambiguous', 'ambiguous-session', 'done',
  '2026-05-10T00:00:00.000Z', 'fake', 'model', 'prompt-v1',
  'contract-v1', 'input-hash', 1, '2026-05-10T00:00:00.000Z',
  '2026-05-10T00:00:00.000Z'
);

INSERT INTO meeting_notes_drafts (
  id, session_id, ai_cleanup_job_id, schema_version, language, title,
  summary_text, draft_json, markdown, json_path, markdown_path,
  raw_output_path, provider, model, prompt_version, input_hash, output_hash,
  validation_status, created_at, updated_at
) VALUES (
  'draft-ambiguous', 'ambiguous-session', 'ai-job-ambiguous', 'v1',
  'ko', '회의록', '요약', '{}', '# 회의록', 'draft.json', 'draft.md',
  'raw.txt', 'fake', 'model', 'prompt-v1', 'input-hash', 'output-hash',
  'valid', '2026-05-10T00:00:00.000Z', '2026-05-10T00:00:00.000Z'
);

INSERT INTO notion_writes (
  id, project_id, session_id, draft_id, target_type, target_id, target_url,
  content_hash, status, status_message, locked_by, locked_until,
  next_attempt_at, created_at, updated_at
) VALUES (
  'write-forced-default', 'default', 'ambiguous-session', 'draft-ambiguous',
  'data_source', 'data-source-id', 'https://notion.so/database', 'hash',
  'retry_wait', 'retry later', 'stale-worker',
  '2000-01-01T00:00:00.000Z', '2026-05-10T00:00:00.000Z',
  '2026-05-10T00:00:00.000Z', '2026-05-10T00:00:00.000Z'
);

CREATE TABLE notion_workspace_settings (
  project_id TEXT NOT NULL DEFAULT 'default',
  id TEXT NOT NULL DEFAULT 'default',
  locale TEXT NOT NULL,
  parent_page_url TEXT NOT NULL,
  parent_page_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id)
);

CREATE TABLE notion_managed_databases (
  project_id TEXT NOT NULL DEFAULT 'default',
  role TEXT NOT NULL,
  locale TEXT NOT NULL,
  database_id TEXT NOT NULL,
  data_source_id TEXT NOT NULL,
  url TEXT NOT NULL,
  name TEXT NOT NULL,
  created_by_dirong INTEGER NOT NULL DEFAULT 1,
  schema_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, role)
);

CREATE TABLE notion_property_mappings (
  project_id TEXT NOT NULL DEFAULT 'default',
  database_role TEXT NOT NULL,
  semantic_key TEXT NOT NULL,
  property_name TEXT NOT NULL,
  property_id TEXT,
  property_type TEXT NOT NULL,
  locked INTEGER NOT NULL DEFAULT 1,
  source_kind TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, database_role, semantic_key)
);

CREATE TABLE notion_custom_property_rules (
  project_id TEXT NOT NULL DEFAULT 'default',
  database_role TEXT NOT NULL DEFAULT 'meeting',
  property_name TEXT NOT NULL,
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
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, database_role, property_name)
);

CREATE TABLE notion_member_roster_entries (
  project_id TEXT NOT NULL DEFAULT 'default',
  page_id TEXT NOT NULL,
  data_source_id TEXT NOT NULL,
  discord_name TEXT NOT NULL,
  normalized_discord_name TEXT NOT NULL,
  organization TEXT,
  roles_json TEXT NOT NULL,
  normalized_roles_json TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  raw_updated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, page_id)
);

CREATE TABLE notion_member_roster_syncs (
  project_id TEXT NOT NULL DEFAULT 'default',
  data_source_id TEXT NOT NULL,
  status TEXT NOT NULL,
  synced_at TEXT,
  member_count INTEGER NOT NULL DEFAULT 0,
  warning_count INTEGER NOT NULL DEFAULT 0,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, data_source_id)
);
`);
  } finally {
    db.close();
  }
  return fixture;
}

function assertProjectScopedBackfill(db: DatabaseSync): void {
  assert.deepEqual(
    plainRows(db.prepare(
      "SELECT project_id, id, parent_page_url FROM notion_workspace_settings",
    ).all()),
    [
      {
        project_id: "default",
        id: "default",
        parent_page_url: "https://notion.so/parent",
      },
    ],
  );
  assert.deepEqual(
    plainRows(db.prepare(
      "SELECT project_id, role, data_source_id FROM notion_managed_databases",
    ).all()),
    [{ project_id: "default", role: "meeting", data_source_id: "data-source-id" }],
  );
  assert.deepEqual(
    plainRows(db.prepare(
      `SELECT project_id, database_role, semantic_key
       FROM notion_property_mappings`,
    ).all()),
    [
      {
        project_id: "default",
        database_role: "meeting",
        semantic_key: "meeting.title",
      },
    ],
  );
  assert.deepEqual(
    plainRows(db.prepare(
      `SELECT project_id, database_role, property_name
       FROM notion_custom_property_rules`,
    ).all()),
    [{ project_id: "default", database_role: "meeting", property_name: "Mood" }],
  );
  assert.deepEqual(
    plainRows(db.prepare("SELECT project_id, id FROM notion_writes").all()),
    [{ project_id: "default", id: "write-1" }],
  );
  assert.deepEqual(
    plainRows(db.prepare("SELECT notion_write_id, block_index FROM notion_blocks").all()),
    [{ notion_write_id: "write-1", block_index: 0 }],
  );
  assert.deepEqual(
    plainRows(db.prepare(
      "SELECT project_id, page_id FROM notion_member_roster_entries",
    ).all()),
    [{ project_id: "default", page_id: "member-page-1" }],
  );
  assert.deepEqual(
    plainRows(db.prepare(
      "SELECT project_id, data_source_id FROM notion_member_roster_syncs",
    ).all()),
    [{ project_id: "default", data_source_id: "member-source" }],
  );
}

function plainRow(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? { ...(value as Record<string, unknown>) }
    : null;
}

function plainRows(values: unknown[]): Array<Record<string, unknown>> {
  return values.map((value) => ({ ...(value as Record<string, unknown>) }));
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
