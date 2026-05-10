import { DatabaseSync } from "node:sqlite";

type SchemaMigration = {
  id: string;
  apply: (db: DatabaseSync) => void;
};

export const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [
  {
    id: "001_transcript_segments_speech_status",
    apply: migrateTranscriptSegmentsSpeechStatus,
  },
  {
    id: "002_notion_writes",
    apply: migrateNotionWrites,
  },
  {
    id: "003_notion_custom_property_rules",
    apply: migrateNotionCustomPropertyRules,
  },
  {
    id: "004_notion_relation_property_rules",
    apply: migrateNotionRelationPropertyRules,
  },
  {
    id: "005_notion_relation_target_pages",
    apply: migrateNotionRelationTargetPages,
  },
  {
    id: "006_notion_custom_property_value_source",
    apply: migrateNotionCustomPropertyValueSource,
  },
];

export function listPendingSchemaMigrationIds(db: DatabaseSync): string[] {
  const appliedMigrationIds = new Set(
    tableExists(db, "dirong_migrations")
      ? (
          db.prepare("SELECT id FROM dirong_migrations;").all() as Array<{
            id: string;
          }>
        ).map((row) => row.id)
      : [],
  );

  return SCHEMA_MIGRATIONS
    .filter((migration) => !appliedMigrationIds.has(migration.id))
    .map((migration) => migration.id);
}

export function applySchemaMigrations(db: DatabaseSync): void {
  ensureMigrationTable(db);

  const pendingMigrationIds = new Set(listPendingSchemaMigrationIds(db));
  for (const migration of SCHEMA_MIGRATIONS) {
    if (!pendingMigrationIds.has(migration.id)) {
      continue;
    }

    db.exec("BEGIN IMMEDIATE;");
    try {
      migration.apply(db);
      db.prepare(
        "INSERT INTO dirong_migrations (id, applied_at) VALUES (?, ?);",
      ).run(migration.id, new Date().toISOString());
      db.exec("COMMIT;");
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    }
  }
}

function ensureMigrationTable(db: DatabaseSync): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS dirong_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
`);
}

function tableExists(db: DatabaseSync, tableName: string): boolean {
  const row = db.prepare(
    "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?;",
  ).get(tableName) as { ok: number } | undefined;
  return row?.ok === 1;
}

function migrateTranscriptSegmentsSpeechStatus(db: DatabaseSync): void {
  const transcriptColumns = db.prepare(
    "PRAGMA table_info(transcript_segments);",
  ).all() as Array<{ name: string }>;
  const transcriptColumnNames = new Set(
    transcriptColumns.map((column) => column.name),
  );

  if (
    transcriptColumns.length > 0 &&
    !transcriptColumnNames.has("speech_status")
  ) {
    db.exec(
      "ALTER TABLE transcript_segments ADD COLUMN speech_status TEXT NOT NULL DEFAULT 'speech';",
    );
  }

  db.exec(
    `UPDATE transcript_segments
     SET speech_status = CASE
       WHEN length(trim(text)) = 0 THEN 'no_speech'
       WHEN speech_status IS NULL OR trim(speech_status) = '' THEN 'speech'
       ELSE speech_status
     END;`,
  );
}

function migrateNotionWrites(db: DatabaseSync): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS notion_writes (
  id TEXT PRIMARY KEY,
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
  UNIQUE (draft_id, target_type, target_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (draft_id) REFERENCES meeting_notes_drafts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notion_writes_status_next_attempt
  ON notion_writes(status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_notion_writes_session_created
  ON notion_writes(session_id, created_at);

CREATE TABLE IF NOT EXISTS notion_blocks (
  notion_write_id TEXT NOT NULL,
  block_index INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  notion_block_id TEXT,
  status TEXT NOT NULL,
  appended_at TEXT,
  last_error TEXT,
  PRIMARY KEY (notion_write_id, block_index),
  FOREIGN KEY (notion_write_id) REFERENCES notion_writes(id) ON DELETE CASCADE
);
`);
}

function migrateNotionCustomPropertyRules(db: DatabaseSync): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS notion_custom_property_rules (
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

CREATE INDEX IF NOT EXISTS idx_notion_custom_property_rules_enabled
  ON notion_custom_property_rules(enabled, property_name);
`);
}

function migrateNotionRelationPropertyRules(db: DatabaseSync): void {
  const columns = new Set(
    (
      db.prepare("PRAGMA table_info(notion_custom_property_rules);").all() as Array<{
        name: string;
      }>
    ).map((column) => column.name),
  );

  if (!columns.has("relation_target_url")) {
    db.exec("ALTER TABLE notion_custom_property_rules ADD COLUMN relation_target_url TEXT;");
  }
  if (!columns.has("relation_data_source_id")) {
    db.exec("ALTER TABLE notion_custom_property_rules ADD COLUMN relation_data_source_id TEXT;");
  }
  if (!columns.has("relation_match_property_name")) {
    db.exec(
      "ALTER TABLE notion_custom_property_rules ADD COLUMN relation_match_property_name TEXT NOT NULL DEFAULT 'Name';",
    );
  }
  if (!columns.has("relation_auto_create")) {
    db.exec(
      "ALTER TABLE notion_custom_property_rules ADD COLUMN relation_auto_create INTEGER NOT NULL DEFAULT 0;",
    );
  }
}

function migrateNotionRelationTargetPages(db: DatabaseSync): void {
  const columns = new Set(
    (
      db.prepare("PRAGMA table_info(notion_custom_property_rules);").all() as Array<{
        name: string;
      }>
    ).map((column) => column.name),
  );

  if (!columns.has("relation_target_page_url")) {
    db.exec("ALTER TABLE notion_custom_property_rules ADD COLUMN relation_target_page_url TEXT;");
  }
  if (!columns.has("relation_target_page_id")) {
    db.exec("ALTER TABLE notion_custom_property_rules ADD COLUMN relation_target_page_id TEXT;");
  }
}

function migrateNotionCustomPropertyValueSource(db: DatabaseSync): void {
  const columns = new Set(
    (
      db.prepare("PRAGMA table_info(notion_custom_property_rules);").all() as Array<{
        name: string;
      }>
    ).map((column) => column.name),
  );

  if (!columns.has("value_source")) {
    db.exec(
      "ALTER TABLE notion_custom_property_rules ADD COLUMN value_source TEXT NOT NULL DEFAULT 'ai';",
    );
  }

  db.exec(
    `UPDATE notion_custom_property_rules
     SET value_source = 'ai'
     WHERE value_source IS NULL
        OR value_source NOT IN ('ai', 'participants');`,
  );
}
