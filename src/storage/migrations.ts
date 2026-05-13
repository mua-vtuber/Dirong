import { DatabaseSync } from "node:sqlite";
import { DEFAULT_PROJECT_ID } from "../projects/project-types.js";
import { NOTION_WRITES_SCHEMA_SQL } from "./schema-fragments/notion-002.js";
import { NOTION_CUSTOM_PROPERTY_RULES_SCHEMA_SQL } from "./schema-fragments/notion-003.js";
import { NOTION_REGISTRY_SCHEMA_SQL } from "./schema-fragments/notion-007.js";
import { NOTION_MEMBER_ROSTER_SCHEMA_SQL } from "./schema-fragments/notion-009.js";
import { PROJECT_FOUNDATION_SCHEMA_SQL } from "./schema-fragments/projects-010.js";

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
  {
    id: "010_project_foundation",
    apply: migrateProjectFoundation,
  },
  {
    id: "011_project_foundation_hardening",
    apply: migrateProjectFoundationHardening,
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

function readColumnInfo(
  db: DatabaseSync,
  tableName: string,
): Map<string, { name: string; notnull: number }> {
  return new Map(
    (
      db.prepare(`PRAGMA table_info(${sqliteIdentifier(tableName)});`).all() as Array<{
        name: string;
        notnull: number;
      }>
    ).map((column) => [column.name, column]),
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
    db.exec(columns.has("project_id") ? `
DROP INDEX IF EXISTS idx_notion_custom_property_rules_enabled;
CREATE INDEX IF NOT EXISTS idx_notion_custom_property_rules_enabled
  ON notion_custom_property_rules(project_id, database_role, enabled, property_name);
` : `
DROP INDEX IF EXISTS idx_notion_custom_property_rules_enabled;
CREATE INDEX IF NOT EXISTS idx_notion_custom_property_rules_enabled
  ON notion_custom_property_rules(database_role, enabled, property_name);
`);
    return;
  }

  db.exec(PROJECT_FOUNDATION_SCHEMA_SQL);
  const defaultProject = readDefaultProjectBackfill(db);
  upsertDefaultProject(db, defaultProject);
  seedDefaultProjectState(db, defaultProject.nowIso);
  seedDefaultUploadScope(db, defaultProject.nowIso);

  db.exec(`
CREATE TABLE notion_custom_property_rules_new (
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
  PRIMARY KEY (project_id, database_role, property_name),
  FOREIGN KEY (project_id) REFERENCES dirong_projects(id)
);

INSERT INTO notion_custom_property_rules_new (
  project_id, database_role, property_name, property_id, property_type, value_source,
  enabled, prompt_description, max_length, relation_target_url,
  relation_data_source_id, relation_target_page_url, relation_target_page_id,
  relation_match_property_name, relation_auto_create, last_seen_at,
  created_at, updated_at
)
SELECT
  'default', 'meeting', property_name, property_id, property_type, value_source,
  enabled, prompt_description, max_length, relation_target_url,
  relation_data_source_id, relation_target_page_url, relation_target_page_id,
  relation_match_property_name, relation_auto_create, last_seen_at,
  created_at, updated_at
FROM notion_custom_property_rules;

DROP TABLE notion_custom_property_rules;
ALTER TABLE notion_custom_property_rules_new RENAME TO notion_custom_property_rules;

CREATE INDEX idx_notion_custom_property_rules_enabled
  ON notion_custom_property_rules(project_id, database_role, enabled, property_name);
`);
}

function migrateNotionMemberRosterCache(db: DatabaseSync): void {
  db.exec(NOTION_MEMBER_ROSTER_SCHEMA_SQL);
}

function migrateProjectFoundation(db: DatabaseSync): void {
  db.exec(PROJECT_FOUNDATION_SCHEMA_SQL);

  const sessionsColumns = readColumnNames(db, "sessions");
  if (sessionsColumns.size > 0) {
    addColumnIfMissing(
      db,
      "sessions",
      sessionsColumns,
      "project_id",
      "TEXT REFERENCES dirong_projects(id)",
    );
  }

  const defaultProject = readDefaultProjectBackfill(db);
  upsertDefaultProject(db, defaultProject);
  seedDefaultProjectState(db, defaultProject.nowIso);
  seedDefaultUploadScope(db, defaultProject.nowIso);

  if (
    defaultProject.guildId &&
    tableExists(db, "sessions") &&
    readColumnNames(db, "sessions").has("guild_id")
  ) {
    db.prepare(
      `UPDATE sessions
       SET project_id = ?
       WHERE project_id IS NULL
         AND guild_id = ?;`,
    ).run(DEFAULT_PROJECT_ID, defaultProject.guildId);
  }

  createSessionsProjectIndexIfPossible(db);
  migrateNotionWritesProjectScope(db);
  migrateNotionRegistryProjectScope(db);
  migrateNotionCustomPropertyRulesProjectScope(db);
  migrateNotionMemberRosterProjectScope(db);
}

function migrateProjectFoundationHardening(db: DatabaseSync): void {
  db.exec(PROJECT_FOUNDATION_SCHEMA_SQL);

  const sessionsColumns = readColumnNames(db, "sessions");
  if (sessionsColumns.size > 0) {
    addColumnIfMissing(
      db,
      "sessions",
      sessionsColumns,
      "project_id",
      "TEXT REFERENCES dirong_projects(id)",
    );
  }

  createSessionsProjectIndexIfPossible(db);
  hardenNotionWritesProjectScope(db);
}

type DefaultProjectBackfill = {
  guildId: string | null;
  guildName: string | null;
  notionParentPageUrl: string | null;
  lifecycleStatus: "draft" | "ready";
  nowIso: string;
};

function readDefaultProjectBackfill(db: DatabaseSync): DefaultProjectBackfill {
  const guild = readUnambiguousLegacyGuild(db);
  const notionParentPageUrl = readLegacyNotionParentPageUrl(db);
  const hasLegacyNotionData =
    Boolean(notionParentPageUrl) ||
    tableHasRows(db, "notion_managed_databases") ||
    tableHasRows(db, "notion_property_mappings") ||
    tableHasRows(db, "notion_custom_property_rules") ||
    tableHasRows(db, "notion_member_roster_entries") ||
    tableHasRows(db, "notion_writes");
  return {
    guildId: guild?.guildId ?? null,
    guildName: guild?.guildName ?? null,
    notionParentPageUrl,
    lifecycleStatus: guild || hasLegacyNotionData ? "ready" : "draft",
    nowIso: new Date().toISOString(),
  };
}

function readUnambiguousLegacyGuild(
  db: DatabaseSync,
): { guildId: string; guildName: string | null } | null {
  if (!tableExists(db, "sessions")) {
    return null;
  }
  const columns = readColumnNames(db, "sessions");
  if (!columns.has("guild_id")) {
    return null;
  }

  const guildNameExpression = columns.has("guild_name")
    ? "MAX(NULLIF(trim(guild_name), ''))"
    : "NULL";
  const rows = db
    .prepare(
      `SELECT guild_id, ${guildNameExpression} AS guild_name
       FROM sessions
       WHERE guild_id IS NOT NULL
         AND length(trim(guild_id)) > 0
       GROUP BY guild_id
       ORDER BY guild_id ASC;`,
    )
    .all() as Array<{ guild_id: string; guild_name: string | null }>;

  if (rows.length !== 1) {
    return null;
  }
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    guildId: row.guild_id,
    guildName: row.guild_name,
  };
}

function readLegacyNotionParentPageUrl(db: DatabaseSync): string | null {
  if (!tableExists(db, "notion_workspace_settings")) {
    return null;
  }
  const columns = readColumnNames(db, "notion_workspace_settings");
  if (!columns.has("parent_page_url")) {
    return null;
  }
  const orderBy = [
    columns.has("id") ? "CASE WHEN id = 'default' THEN 0 ELSE 1 END" : "0",
    columns.has("updated_at") ? "updated_at DESC" : "parent_page_url ASC",
  ].join(", ");
  const row = db
    .prepare(
      `SELECT parent_page_url
       FROM notion_workspace_settings
       WHERE parent_page_url IS NOT NULL
         AND length(trim(parent_page_url)) > 0
       ORDER BY ${orderBy}
       LIMIT 1;`,
    )
    .get() as { parent_page_url: string } | undefined;
  return row?.parent_page_url ?? null;
}

function upsertDefaultProject(
  db: DatabaseSync,
  input: DefaultProjectBackfill,
): void {
  db.prepare(
    `INSERT INTO dirong_projects (
       id, name, lifecycle_status, guild_id, guild_name, guild_icon_url,
       command_enabled, notion_token_secret_ref, notion_parent_page_url,
       notion_upload_mode, created_at, updated_at, archived_at
     ) VALUES (
       ?, ?, ?, ?, ?, NULL, 1, NULL, ?, 'manual', ?, ?, NULL
     )
     ON CONFLICT(id) DO UPDATE SET
       name = CASE
         WHEN length(trim(dirong_projects.name)) = 0 THEN excluded.name
         ELSE dirong_projects.name
       END,
       lifecycle_status = CASE
         WHEN dirong_projects.lifecycle_status = 'draft'
           AND excluded.lifecycle_status = 'ready' THEN 'ready'
         ELSE dirong_projects.lifecycle_status
       END,
       guild_id = COALESCE(dirong_projects.guild_id, excluded.guild_id),
       guild_name = COALESCE(dirong_projects.guild_name, excluded.guild_name),
       notion_parent_page_url = COALESCE(
         dirong_projects.notion_parent_page_url,
         excluded.notion_parent_page_url
       ),
       updated_at = excluded.updated_at;`,
  ).run(
    DEFAULT_PROJECT_ID,
    input.guildName ?? "Default Project",
    input.lifecycleStatus,
    input.guildId,
    input.guildName,
    input.notionParentPageUrl,
    input.nowIso,
    input.nowIso,
  );
}

function seedDefaultProjectState(db: DatabaseSync, nowIso: string): void {
  db.prepare(
    `INSERT INTO dirong_project_state (
       id, active_project_id, switching, updated_at
     ) VALUES ('default', ?, 0, ?)
     ON CONFLICT(id) DO UPDATE SET
       active_project_id = COALESCE(
         dirong_project_state.active_project_id,
         excluded.active_project_id
       ),
       switching = 0,
       updated_at = excluded.updated_at;`,
  ).run(DEFAULT_PROJECT_ID, nowIso);
}

function seedDefaultUploadScope(db: DatabaseSync, nowIso: string): void {
  db.prepare(
    `INSERT INTO notion_upload_scope (
       project_id, automatic_upload_after, reset_mode, reset_at, updated_at
     ) VALUES (?, '1970-01-01T00:00:00.000Z', NULL, NULL, ?)
     ON CONFLICT(project_id) DO NOTHING;`,
  ).run(DEFAULT_PROJECT_ID, nowIso);
}

function createSessionsProjectIndexIfPossible(db: DatabaseSync): void {
  if (!tableExists(db, "sessions")) {
    return;
  }
  const columns = readColumnNames(db, "sessions");
  if (!columns.has("project_id") || !columns.has("started_at")) {
    return;
  }
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_sessions_project_started
       ON sessions(project_id, started_at);`,
  );
}

function migrateNotionWritesProjectScope(db: DatabaseSync): void {
  if (!tableExists(db, "notion_writes")) {
    db.exec(NOTION_WRITES_SCHEMA_SQL);
    return;
  }
  if (readColumnNames(db, "notion_writes").has("project_id")) {
    db.exec(`
CREATE INDEX IF NOT EXISTS idx_notion_writes_project_status_next_attempt
  ON notion_writes(project_id, status, next_attempt_at);
`);
    return;
  }

  const hasBlocks = tableExists(db, "notion_blocks");
  db.exec(`
DROP INDEX IF EXISTS idx_notion_writes_status_next_attempt;
DROP INDEX IF EXISTS idx_notion_writes_project_status_next_attempt;
DROP INDEX IF EXISTS idx_notion_writes_session_created;

ALTER TABLE notion_writes RENAME TO notion_writes_old;

CREATE TABLE notion_writes (
  id TEXT PRIMARY KEY,
  project_id TEXT DEFAULT 'default',
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
  UNIQUE (draft_id, project_id, target_type, target_id),
  FOREIGN KEY (project_id) REFERENCES dirong_projects(id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (draft_id) REFERENCES meeting_notes_drafts(id) ON DELETE CASCADE
);

CREATE INDEX idx_notion_writes_status_next_attempt
  ON notion_writes(status, next_attempt_at);

CREATE INDEX idx_notion_writes_project_status_next_attempt
  ON notion_writes(project_id, status, next_attempt_at);

CREATE INDEX idx_notion_writes_session_created
  ON notion_writes(session_id, created_at);
`);

  if (hasBlocks) {
    db.exec("ALTER TABLE notion_blocks RENAME TO notion_blocks_old;");
  }

  db.exec(`
CREATE TABLE notion_blocks (
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

INSERT INTO notion_writes (
  id, project_id, session_id, draft_id, target_type, target_id, target_url,
  notion_page_id, notion_page_url, content_hash, status, status_message,
  last_successful_block_index, attempts, max_attempts, locked_by,
  locked_until, next_attempt_at, last_error, created_at, updated_at
)
SELECT
  w.id,
  (SELECT s.project_id FROM sessions s WHERE s.id = w.session_id),
  w.session_id, w.draft_id, w.target_type, w.target_id, w.target_url,
  w.notion_page_id, w.notion_page_url, w.content_hash,
  CASE
    WHEN (SELECT s.project_id FROM sessions s WHERE s.id = w.session_id) IS NULL
      AND w.status IN ('queued', 'processing', 'creating_page', 'appending_blocks', 'retry_wait')
      THEN 'blocked'
    ELSE w.status
  END,
  CASE
    WHEN (SELECT s.project_id FROM sessions s WHERE s.id = w.session_id) IS NULL
      AND w.status IN ('queued', 'processing', 'creating_page', 'appending_blocks', 'retry_wait')
      THEN 'Blocked because the legacy session project is ambiguous.'
    ELSE w.status_message
  END,
  w.last_successful_block_index, w.attempts,
  w.max_attempts,
  CASE
    WHEN (SELECT s.project_id FROM sessions s WHERE s.id = w.session_id) IS NULL
      THEN NULL
    ELSE w.locked_by
  END,
  CASE
    WHEN (SELECT s.project_id FROM sessions s WHERE s.id = w.session_id) IS NULL
      THEN NULL
    ELSE w.locked_until
  END,
  w.next_attempt_at,
  w.last_error, w.created_at, w.updated_at
FROM notion_writes_old w;
`);

  if (hasBlocks) {
    db.exec(`
INSERT INTO notion_blocks (
  notion_write_id, block_index, content_hash, notion_block_id, status,
  appended_at, last_error
)
SELECT
  notion_write_id, block_index, content_hash, notion_block_id, status,
  appended_at, last_error
FROM notion_blocks_old;

DROP TABLE notion_blocks_old;
`);
  }

  db.exec("DROP TABLE notion_writes_old;");
}

function hardenNotionWritesProjectScope(db: DatabaseSync): void {
  if (!tableExists(db, "notion_writes")) {
    db.exec(NOTION_WRITES_SCHEMA_SQL);
    return;
  }

  const columns = readColumnNames(db, "notion_writes");
  if (!columns.has("project_id")) {
    migrateNotionWritesProjectScope(db);
    return;
  }

  const projectColumn = readColumnInfo(db, "notion_writes").get("project_id");
  if (projectColumn?.notnull === 1) {
    rebuildExistingProjectScopedNotionWrites(db);
  }

  db.exec(`
UPDATE notion_writes
SET project_id = CASE
      WHEN (SELECT s.project_id FROM sessions s WHERE s.id = notion_writes.session_id) IS NULL
        THEN NULL
      ELSE project_id
    END,
    status = CASE
      WHEN (SELECT s.project_id FROM sessions s WHERE s.id = notion_writes.session_id) IS NULL
        AND status IN ('queued', 'processing', 'creating_page', 'appending_blocks', 'retry_wait')
        THEN 'blocked'
      ELSE status
    END,
    status_message = CASE
      WHEN (SELECT s.project_id FROM sessions s WHERE s.id = notion_writes.session_id) IS NULL
        AND status IN ('queued', 'processing', 'creating_page', 'appending_blocks', 'retry_wait')
        THEN 'Blocked because the legacy session project is ambiguous.'
      ELSE status_message
    END,
    locked_by = CASE
      WHEN (SELECT s.project_id FROM sessions s WHERE s.id = notion_writes.session_id) IS NULL
        THEN NULL
      ELSE locked_by
    END,
    locked_until = CASE
      WHEN (SELECT s.project_id FROM sessions s WHERE s.id = notion_writes.session_id) IS NULL
        THEN NULL
      ELSE locked_until
    END
WHERE (SELECT s.project_id FROM sessions s WHERE s.id = notion_writes.session_id) IS NULL;

CREATE INDEX IF NOT EXISTS idx_notion_writes_project_status_next_attempt
  ON notion_writes(project_id, status, next_attempt_at);
`);
}

function rebuildExistingProjectScopedNotionWrites(db: DatabaseSync): void {
  const hasBlocks = tableExists(db, "notion_blocks");
  db.exec(`
DROP INDEX IF EXISTS idx_notion_writes_status_next_attempt;
DROP INDEX IF EXISTS idx_notion_writes_project_status_next_attempt;
DROP INDEX IF EXISTS idx_notion_writes_session_created;

ALTER TABLE notion_writes RENAME TO notion_writes_old;

CREATE TABLE notion_writes (
  id TEXT PRIMARY KEY,
  project_id TEXT DEFAULT 'default',
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
  UNIQUE (draft_id, project_id, target_type, target_id),
  FOREIGN KEY (project_id) REFERENCES dirong_projects(id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (draft_id) REFERENCES meeting_notes_drafts(id) ON DELETE CASCADE
);

CREATE INDEX idx_notion_writes_status_next_attempt
  ON notion_writes(status, next_attempt_at);

CREATE INDEX idx_notion_writes_project_status_next_attempt
  ON notion_writes(project_id, status, next_attempt_at);

CREATE INDEX idx_notion_writes_session_created
  ON notion_writes(session_id, created_at);
`);

  if (hasBlocks) {
    db.exec("ALTER TABLE notion_blocks RENAME TO notion_blocks_old;");
  }

  db.exec(`
CREATE TABLE notion_blocks (
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

INSERT INTO notion_writes (
  id, project_id, session_id, draft_id, target_type, target_id, target_url,
  notion_page_id, notion_page_url, content_hash, status, status_message,
  last_successful_block_index, attempts, max_attempts, locked_by,
  locked_until, next_attempt_at, last_error, created_at, updated_at
)
SELECT
  w.id,
  (SELECT s.project_id FROM sessions s WHERE s.id = w.session_id),
  w.session_id, w.draft_id, w.target_type, w.target_id, w.target_url,
  w.notion_page_id, w.notion_page_url, w.content_hash,
  CASE
    WHEN (SELECT s.project_id FROM sessions s WHERE s.id = w.session_id) IS NULL
      AND w.status IN ('queued', 'processing', 'creating_page', 'appending_blocks', 'retry_wait')
      THEN 'blocked'
    ELSE w.status
  END,
  CASE
    WHEN (SELECT s.project_id FROM sessions s WHERE s.id = w.session_id) IS NULL
      AND w.status IN ('queued', 'processing', 'creating_page', 'appending_blocks', 'retry_wait')
      THEN 'Blocked because the legacy session project is ambiguous.'
    ELSE w.status_message
  END,
  w.last_successful_block_index, w.attempts, w.max_attempts,
  CASE
    WHEN (SELECT s.project_id FROM sessions s WHERE s.id = w.session_id) IS NULL
      THEN NULL
    ELSE w.locked_by
  END,
  CASE
    WHEN (SELECT s.project_id FROM sessions s WHERE s.id = w.session_id) IS NULL
      THEN NULL
    ELSE w.locked_until
  END,
  w.next_attempt_at, w.last_error, w.created_at, w.updated_at
FROM notion_writes_old w;
`);

  if (hasBlocks) {
    db.exec(`
INSERT INTO notion_blocks (
  notion_write_id, block_index, content_hash, notion_block_id, status,
  appended_at, last_error
)
SELECT
  notion_write_id, block_index, content_hash, notion_block_id, status,
  appended_at, last_error
FROM notion_blocks_old;

DROP TABLE notion_blocks_old;
`);
  }

  db.exec("DROP TABLE notion_writes_old;");
}

function migrateNotionRegistryProjectScope(db: DatabaseSync): void {
  const tables = [
    "notion_workspace_settings",
    "notion_managed_databases",
    "notion_property_mappings",
  ];
  if (tables.some((tableName) => !tableExists(db, tableName))) {
    db.exec(NOTION_REGISTRY_SCHEMA_SQL);
    return;
  }
  if (
    tables.every((tableName) =>
      readColumnNames(db, tableName).has("project_id"),
    )
  ) {
    db.exec(`
DROP INDEX IF EXISTS idx_notion_property_mappings_database_role;
CREATE INDEX IF NOT EXISTS idx_notion_property_mappings_project_database_role
  ON notion_property_mappings(project_id, database_role, semantic_key);
`);
    return;
  }

  db.exec(`
DROP INDEX IF EXISTS idx_notion_property_mappings_database_role;
DROP INDEX IF EXISTS idx_notion_property_mappings_project_database_role;

ALTER TABLE notion_workspace_settings RENAME TO notion_workspace_settings_old;
ALTER TABLE notion_managed_databases RENAME TO notion_managed_databases_old;
ALTER TABLE notion_property_mappings RENAME TO notion_property_mappings_old;
`);
  db.exec(NOTION_REGISTRY_SCHEMA_SQL);
  db.exec(`
INSERT INTO notion_workspace_settings (
  project_id, id, locale, parent_page_url, parent_page_id, created_at, updated_at
)
SELECT
  'default', id, locale, parent_page_url, parent_page_id, created_at, updated_at
FROM notion_workspace_settings_old
ORDER BY CASE WHEN id = 'default' THEN 0 ELSE 1 END, updated_at DESC
LIMIT 1;

INSERT INTO notion_managed_databases (
  project_id, role, locale, database_id, data_source_id, url, name,
  created_by_dirong, schema_version, created_at, updated_at
)
SELECT
  'default', role, locale, database_id, data_source_id, url, name,
  created_by_dirong, schema_version, created_at, updated_at
FROM notion_managed_databases_old;

INSERT INTO notion_property_mappings (
  project_id, database_role, semantic_key, property_name, property_id,
  property_type, locked, source_kind, created_at, updated_at
)
SELECT
  'default', database_role, semantic_key, property_name, property_id,
  property_type, locked, source_kind, created_at, updated_at
FROM notion_property_mappings_old;

DROP TABLE notion_property_mappings_old;
DROP TABLE notion_managed_databases_old;
DROP TABLE notion_workspace_settings_old;
`);
}

function migrateNotionCustomPropertyRulesProjectScope(db: DatabaseSync): void {
  if (!tableExists(db, "notion_custom_property_rules")) {
    db.exec(NOTION_CUSTOM_PROPERTY_RULES_SCHEMA_SQL);
    return;
  }
  if (readColumnNames(db, "notion_custom_property_rules").has("project_id")) {
    db.exec(`
DROP INDEX IF EXISTS idx_notion_custom_property_rules_enabled;
CREATE INDEX IF NOT EXISTS idx_notion_custom_property_rules_enabled
  ON notion_custom_property_rules(project_id, database_role, enabled, property_name);
`);
    return;
  }

  db.exec(`
DROP INDEX IF EXISTS idx_notion_custom_property_rules_enabled;
ALTER TABLE notion_custom_property_rules RENAME TO notion_custom_property_rules_old;
`);
  db.exec(NOTION_CUSTOM_PROPERTY_RULES_SCHEMA_SQL);
  db.exec(`
INSERT INTO notion_custom_property_rules (
  project_id, database_role, property_name, property_id, property_type,
  value_source, enabled, prompt_description, max_length, relation_target_url,
  relation_data_source_id, relation_target_page_url, relation_target_page_id,
  relation_match_property_name, relation_auto_create, last_seen_at,
  created_at, updated_at
)
SELECT
  'default', database_role, property_name, property_id, property_type,
  value_source, enabled, prompt_description, max_length, relation_target_url,
  relation_data_source_id, relation_target_page_url, relation_target_page_id,
  relation_match_property_name, relation_auto_create, last_seen_at,
  created_at, updated_at
FROM notion_custom_property_rules_old;

DROP TABLE notion_custom_property_rules_old;
`);
}

function migrateNotionMemberRosterProjectScope(db: DatabaseSync): void {
  const tables = ["notion_member_roster_entries", "notion_member_roster_syncs"];
  if (tables.some((tableName) => !tableExists(db, tableName))) {
    db.exec(NOTION_MEMBER_ROSTER_SCHEMA_SQL);
    return;
  }
  if (
    tables.every((tableName) =>
      readColumnNames(db, tableName).has("project_id"),
    )
  ) {
    db.exec(`
DROP INDEX IF EXISTS idx_notion_member_roster_entries_discord_name;
DROP INDEX IF EXISTS idx_notion_member_roster_entries_data_source;
CREATE INDEX IF NOT EXISTS idx_notion_member_roster_entries_project_discord_name
  ON notion_member_roster_entries(project_id, normalized_discord_name);
CREATE INDEX IF NOT EXISTS idx_notion_member_roster_entries_project_data_source
  ON notion_member_roster_entries(project_id, data_source_id, synced_at);
`);
    return;
  }

  db.exec(`
DROP INDEX IF EXISTS idx_notion_member_roster_entries_discord_name;
DROP INDEX IF EXISTS idx_notion_member_roster_entries_data_source;
DROP INDEX IF EXISTS idx_notion_member_roster_entries_project_discord_name;
DROP INDEX IF EXISTS idx_notion_member_roster_entries_project_data_source;

ALTER TABLE notion_member_roster_entries RENAME TO notion_member_roster_entries_old;
ALTER TABLE notion_member_roster_syncs RENAME TO notion_member_roster_syncs_old;
`);
  db.exec(NOTION_MEMBER_ROSTER_SCHEMA_SQL);
  db.exec(`
INSERT INTO notion_member_roster_entries (
  project_id, page_id, data_source_id, discord_name, normalized_discord_name,
  organization, roles_json, normalized_roles_json, synced_at, raw_updated_at,
  created_at, updated_at
)
SELECT
  'default', page_id, data_source_id, discord_name, normalized_discord_name,
  organization, roles_json, normalized_roles_json, synced_at, raw_updated_at,
  created_at, updated_at
FROM notion_member_roster_entries_old;

INSERT INTO notion_member_roster_syncs (
  project_id, data_source_id, status, synced_at, member_count, warning_count,
  warnings_json, last_error, created_at, updated_at
)
SELECT
  'default', data_source_id, status, synced_at, member_count, warning_count,
  warnings_json, last_error, created_at, updated_at
FROM notion_member_roster_syncs_old;

DROP TABLE notion_member_roster_syncs_old;
DROP TABLE notion_member_roster_entries_old;
`);
}

function tableHasRows(db: DatabaseSync, tableName: string): boolean {
  if (!tableExists(db, tableName)) {
    return false;
  }
  const row = db
    .prepare(`SELECT 1 AS ok FROM ${sqliteIdentifier(tableName)} LIMIT 1;`)
    .get() as { ok: number } | undefined;
  return row?.ok === 1;
}
