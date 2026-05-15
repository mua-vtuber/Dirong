import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { applySchemaMigrations } from "./migrations.js";
import { SCHEMA_SQL } from "./schema.js";
import { SqlRunner } from "./sql-runner.js";

const CRITICAL_NOTION_TABLES = [
  "dirong_projects",
  "dirong_project_state",
  "notion_upload_scope",
  "notion_writes",
  "notion_blocks",
  "notion_custom_property_rules",
  "notion_workspace_settings",
  "notion_managed_databases",
  "notion_property_mappings",
  "notion_member_roster_entries",
  "notion_member_roster_syncs",
] as const;

test("fresh schema and migration-only schema keep critical Notion tables aligned", () => {
  const fixture = createFixture();
  const fresh = new DatabaseSync(path.join(fixture.dir, "fresh.sqlite"));
  const migrated = new DatabaseSync(path.join(fixture.dir, "migrated.sqlite"));
  try {
    fresh.exec(SCHEMA_SQL);
    applySchemaMigrations(SqlRunner.fromDatabaseSync(fresh));

    migrated.exec(PRE_NOTION_PREREQUISITE_SCHEMA_SQL);
    applySchemaMigrations(SqlRunner.fromDatabaseSync(migrated));

    assert.deepEqual(readSchemaShape(migrated), readSchemaShape(fresh));
    assert.deepEqual(readMigrationIds(migrated), readMigrationIds(fresh));
  } finally {
    fresh.close();
    migrated.close();
    fixture.close();
  }
});

type Fixture = {
  dir: string;
  close: () => void;
};

type TableShape = {
  columns: ColumnShape[];
  indexes: IndexShape[];
  foreignKeys: ForeignKeyShape[];
};

type ColumnShape = {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
};

type IndexShape = {
  key: string;
  unique: number;
  origin: string;
  partial: number;
  columns: string[];
};

type ForeignKeyShape = {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  on_update: string;
  on_delete: string;
  match: string;
};

const PRE_NOTION_PREREQUISITE_SCHEMA_SQL = `
CREATE TABLE transcript_segments (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY
);

CREATE TABLE meeting_notes_drafts (
  id TEXT PRIMARY KEY
);
`;

function createFixture(): Fixture {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-schema-consistency-"));
  return {
    dir,
    close: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function readSchemaShape(db: DatabaseSync): Record<string, TableShape> {
  return Object.fromEntries(
    CRITICAL_NOTION_TABLES.map((tableName) => [
      tableName,
      {
        columns: readColumns(db, tableName),
        indexes: readIndexes(db, tableName),
        foreignKeys: readForeignKeys(db, tableName),
      },
    ]),
  );
}

function readColumns(db: DatabaseSync, tableName: string): ColumnShape[] {
  return (
    db.prepare(`PRAGMA table_info(${tableName});`).all() as ColumnShape[]
  ).sort((left, right) => left.cid - right.cid);
}

function readIndexes(db: DatabaseSync, tableName: string): IndexShape[] {
  const rows = db.prepare(`PRAGMA index_list(${tableName});`).all() as Array<{
    name: string;
    unique: number;
    origin: string;
    partial: number;
  }>;
  return rows
    .map((row) => {
      const columns = (
        db.prepare(`PRAGMA index_info(${row.name});`).all() as Array<{
          seqno: number;
          name: string;
        }>
      )
        .sort((left, right) => left.seqno - right.seqno)
        .map((column) => column.name);
      return {
        key: row.name.startsWith("sqlite_autoindex")
          ? `auto:${row.origin}:${columns.join(",")}`
          : row.name,
        unique: row.unique,
        origin: row.origin,
        partial: row.partial,
        columns,
      };
    })
    .sort((left, right) => left.key.localeCompare(right.key));
}

function readForeignKeys(
  db: DatabaseSync,
  tableName: string,
): ForeignKeyShape[] {
  return (
    db.prepare(`PRAGMA foreign_key_list(${tableName});`).all() as ForeignKeyShape[]
  ).sort((left, right) => left.id - right.id || left.seq - right.seq);
}

function readMigrationIds(db: DatabaseSync): string[] {
  return (
    db.prepare("SELECT id FROM dirong_migrations ORDER BY id;").all() as Array<{
      id: string;
    }>
  ).map((row) => row.id);
}
