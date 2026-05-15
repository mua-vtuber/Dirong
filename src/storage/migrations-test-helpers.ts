import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type DatabaseSync, type StatementSync } from "node:sqlite";
import { SCHEMA_MIGRATIONS } from "./migrations.js";
import { DirongDatabase } from "./sqlite.js";

// Helpers for STORE-03 (per-migration idempotency) + TEST-02 (mid-step crash-recovery)
// living in src/storage/migrations.test.ts. This file is intentionally NOT a *.test.ts
// so that node --test does not try to load it as a runnable suite, and so that it
// stays out of the package.json#scripts.test enumeration.

export type SchemaSnapshot = {
  tables: Record<
    string,
    {
      columns: Array<Record<string, unknown>>;
      indexes: Array<Record<string, unknown>>;
    }
  >;
};

export function createTmpDirongDatabase(): {
  database: DirongDatabase;
  dbPath: string;
  tmpDir: string;
  close(): void;
} {
  // Real on-disk file required: DirongDatabase writes a *.bak.sqlite snapshot for
  // non-empty DBs and uses WAL — neither works against :memory:.
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "dirong-migrate-"));
  const dbPath = path.join(tmpDir, "dirong.sqlite");
  const database = new DirongDatabase(dbPath, 1000);
  return {
    database,
    dbPath,
    tmpDir,
    close(): void {
      try {
        database.close();
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  };
}

export function snapshotSchema(db: DatabaseSync): SchemaSnapshot {
  const tableRows = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;",
    )
    .all() as Array<{ name: string }>;

  const tables: SchemaSnapshot["tables"] = {};
  for (const row of tableRows) {
    if (!row || typeof row.name !== "string") {
      continue;
    }
    if (row.name.startsWith("sqlite_")) {
      // Filter out internal tables (sqlite_sequence, sqlite_stat1, etc.) so they
      // don't add nondeterministic noise across runs.
      continue;
    }
    const columns = (
      db.prepare(`PRAGMA table_info(${quoteIdent(row.name)});`).all() as Array<
        Record<string, unknown>
      >
    )
      .map((column) => ({ ...column }))
      .sort(byNumericKey("cid"));
    const indexes = (
      db.prepare(`PRAGMA index_list(${quoteIdent(row.name)});`).all() as Array<
        Record<string, unknown>
      >
    )
      .map((index) => ({ ...index }))
      .sort(byNumericKey("seq"));
    tables[row.name] = { columns, indexes };
  }

  return { tables };
}

export function runMigrationTwiceAndDiffSchema(migrationId: string): {
  before: SchemaSnapshot;
  after: SchemaSnapshot;
} {
  const fixture = createTmpDirongDatabase();
  try {
    const migration = SCHEMA_MIGRATIONS.find((entry) => entry.id === migrationId);
    if (!migration) {
      throw new Error(
        `runMigrationTwiceAndDiffSchema: unknown migration id ${migrationId}`,
      );
    }
    // DirongDatabase constructor already ran every migration once. The fresh DB now
    // represents the "post-first-apply" state for `migrationId`. We snapshot, then
    // re-invoke `migration.apply` directly (bypassing the ledger guard inside
    // applySchemaMigrations) to exercise the SECOND application against a state
    // where the migration has already done its work.
    const before = snapshotSchema(fixture.database.db);
    migration.apply(fixture.database.db);
    const after = snapshotSchema(fixture.database.db);
    return { before, after };
  } finally {
    fixture.close();
  }
}

// Wrapper around DatabaseSync used by TEST-02 to inject a deterministic mid-body
// crash. Exposes only the surface SqlRunner.fromDatabaseSync consumes
// (db, exec, prepare, close); BEGIN IMMEDIATE / COMMIT / ROLLBACK issued by the
// adapter pass through `exec` and therefore count toward execCallCount (per
// executor advisory A1: choose throwOnNthExec strictly inside the migration
// body, NOT on the adapter's BEGIN or COMMIT).
export class FaultInjectingDatabaseSync {
  readonly db: this = this;
  private execCallCount = 0;

  constructor(
    private readonly realDb: DatabaseSync,
    private readonly throwOnNthExec: number,
  ) {}

  exec(sql: string): void {
    this.execCallCount += 1;
    if (this.execCallCount === this.throwOnNthExec) {
      throw new Error(
        `injected fault: db.exec call #${this.execCallCount}`,
      );
    }
    this.realDb.exec(sql);
  }

  prepare(sql: string): StatementSync {
    return this.realDb.prepare(sql);
  }

  close(): void {
    this.realDb.close();
  }
}

function byNumericKey(
  key: string,
): (a: Record<string, unknown>, b: Record<string, unknown>) => number {
  return (a, b) => {
    const av = Number(a[key] ?? 0);
    const bv = Number(b[key] ?? 0);
    return av - bv;
  };
}

function quoteIdent(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid SQLite identifier: ${value}`);
  }
  return value;
}
