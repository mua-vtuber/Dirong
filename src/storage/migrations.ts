import { DatabaseSync } from "node:sqlite";
import { NOTION_WRITES_SCHEMA_SQL } from "./schema-fragments/notion-002.js";
import { NOTION_CUSTOM_PROPERTY_RULES_SCHEMA_SQL } from "./schema-fragments/notion-003.js";
import { NOTION_REGISTRY_SCHEMA_SQL } from "./schema-fragments/notion-007.js";
import { NOTION_MEMBER_ROSTER_SCHEMA_SQL } from "./schema-fragments/notion-009.js";

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
  {
    id: "007_notion_registry",
    apply: migrateNotionRegistry,
  },
  {
    id: "008_notion_custom_property_rule_roles",
    apply: migrateNotionCustomPropertyRuleRoles,
  },
  {
    id: "009_notion_member_roster_cache",
    apply: migrateNotionMemberRosterCache,
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

function readColumnNames(db: DatabaseSync, tableName: string): Set<string> {
  return new Set(
    (
      db.prepare(`PRAGMA table_info(${sqliteIdentifier(tableName)});`).all() as Array<{
        name: string;
      }>
    ).map((column) => column.name),
  );
}

function addColumnIfMissing(
  db: DatabaseSync,
  tableName: string,
  columns: Set<string>,
  columnName: string,
  definition: string,
): void {
  if (columns.has(columnName)) {
    return;
  }

  db.exec(
    `ALTER TABLE ${sqliteIdentifier(tableName)} ADD COLUMN ${sqliteIdentifier(
      columnName,
    )} ${definition};`,
  );
  columns.add(columnName);
}

function sqliteIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid SQLite identifier: ${value}`);
  }
  return value;
}

function migrateTranscriptSegmentsSpeechStatus(db: DatabaseSync): void {
  const columns = readColumnNames(db, "transcript_segments");
  if (columns.size > 0) {
    addColumnIfMissing(
      db,
      "transcript_segments",
      columns,
      "speech_status",
      "TEXT NOT NULL DEFAULT 'speech'",
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
  db.exec(NOTION_WRITES_SCHEMA_SQL);
}

function migrateNotionCustomPropertyRules(db: DatabaseSync): void {
  db.exec(NOTION_CUSTOM_PROPERTY_RULES_SCHEMA_SQL);
}

function migrateNotionRelationPropertyRules(db: DatabaseSync): void {
  const tableName = "notion_custom_property_rules";
  const columns = readColumnNames(db, tableName);

  addColumnIfMissing(db, tableName, columns, "relation_target_url", "TEXT");
  addColumnIfMissing(db, tableName, columns, "relation_data_source_id", "TEXT");
  addColumnIfMissing(
    db,
    tableName,
    columns,
    "relation_match_property_name",
    "TEXT NOT NULL DEFAULT 'Name'",
  );
  addColumnIfMissing(
    db,
    tableName,
    columns,
    "relation_auto_create",
    "INTEGER NOT NULL DEFAULT 0",
  );
}

function migrateNotionRelationTargetPages(db: DatabaseSync): void {
  const tableName = "notion_custom_property_rules";
  const columns = readColumnNames(db, tableName);

  addColumnIfMissing(db, tableName, columns, "relation_target_page_url", "TEXT");
  addColumnIfMissing(db, tableName, columns, "relation_target_page_id", "TEXT");
}

function migrateNotionCustomPropertyValueSource(db: DatabaseSync): void {
  const tableName = "notion_custom_property_rules";
  const columns = readColumnNames(db, tableName);

  addColumnIfMissing(
    db,
    tableName,
    columns,
    "value_source",
    "TEXT NOT NULL DEFAULT 'ai'",
  );

  db.exec(
    `UPDATE notion_custom_property_rules
     SET value_source = 'ai'
     WHERE value_source IS NULL
        OR value_source NOT IN ('ai', 'participants');`,
  );
}

function migrateNotionRegistry(db: DatabaseSync): void {
  db.exec(NOTION_REGISTRY_SCHEMA_SQL);
}

function migrateNotionCustomPropertyRuleRoles(db: DatabaseSync): void {
  if (!tableExists(db, "notion_custom_property_rules")) {
    db.exec(NOTION_CUSTOM_PROPERTY_RULES_SCHEMA_SQL);
    return;
  }

  const columns = readColumnNames(db, "notion_custom_property_rules");
  if (columns.has("database_role")) {
    db.exec(`
DROP INDEX IF EXISTS idx_notion_custom_property_rules_enabled;
CREATE INDEX IF NOT EXISTS idx_notion_custom_property_rules_enabled
  ON notion_custom_property_rules(database_role, enabled, property_name);
`);
    return;
  }

  db.exec(`
CREATE TABLE notion_custom_property_rules_new (
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

INSERT INTO notion_custom_property_rules_new (
  database_role, property_name, property_id, property_type, value_source,
  enabled, prompt_description, max_length, relation_target_url,
  relation_data_source_id, relation_target_page_url, relation_target_page_id,
  relation_match_property_name, relation_auto_create, last_seen_at,
  created_at, updated_at
)
SELECT
  'meeting', property_name, property_id, property_type, value_source,
  enabled, prompt_description, max_length, relation_target_url,
  relation_data_source_id, relation_target_page_url, relation_target_page_id,
  relation_match_property_name, relation_auto_create, last_seen_at,
  created_at, updated_at
FROM notion_custom_property_rules;

DROP TABLE notion_custom_property_rules;
ALTER TABLE notion_custom_property_rules_new RENAME TO notion_custom_property_rules;

CREATE INDEX idx_notion_custom_property_rules_enabled
  ON notion_custom_property_rules(database_role, enabled, property_name);
`);
}

function migrateNotionMemberRosterCache(db: DatabaseSync): void {
  db.exec(NOTION_MEMBER_ROSTER_SCHEMA_SQL);
}
