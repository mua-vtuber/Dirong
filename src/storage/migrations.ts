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
