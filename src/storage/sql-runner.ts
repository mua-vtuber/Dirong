import { type DatabaseSync } from "node:sqlite";
import { type SqlValue } from "./sqlite.js";

// Structural shape that SqlRunner needs from its host. DirongDatabase satisfies this naturally;
// the test-only adapter built by SqlRunner.fromDatabaseSync also satisfies it.
export type SqlRunnerHost = {
  readonly db: DatabaseSync;
  transaction<T>(fn: () => T): T;
};

export class SqlRunner {
  constructor(private readonly database: SqlRunnerHost) {}

  // migration runner needs the raw DatabaseSync for PRAGMA / DDL outside transactions; do not use elsewhere.
  get db(): DatabaseSync {
    return this.database.db;
  }

  // test-only: wraps a bare DatabaseSync (e.g. in schema-consistency.test.ts where DirongDatabase is not in use); production code MUST construct via new SqlRunner(dirongDatabase).
  static fromDatabaseSync(database: DatabaseSync): SqlRunner {
    const adapter: SqlRunnerHost = {
      db: database,
      transaction<T>(fn: () => T): T {
        database.exec("BEGIN IMMEDIATE;");
        try {
          const result = fn();
          database.exec("COMMIT;");
          return result;
        } catch (error) {
          database.exec("ROLLBACK;");
          throw error;
        }
      },
    };
    return new SqlRunner(adapter);
  }

  transaction<T>(fn: () => T): T {
    return this.database.transaction(fn);
  }

  run(sql: string, ...params: SqlValue[]): number {
    const result = this.database.db.prepare(sql).run(...params) as {
      changes?: number | bigint;
    };
    return Number(result.changes ?? 0);
  }

  get<T>(sql: string, ...params: SqlValue[]): T | null {
    const row = this.database.db.prepare(sql).get(...params);
    return row === undefined ? null : (row as T);
  }

  all<T = Record<string, unknown>>(sql: string, ...params: SqlValue[]): T[] {
    return this.database.db.prepare(sql).all(...params) as T[];
  }
}
