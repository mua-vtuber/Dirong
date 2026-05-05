import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA_SQL } from "./schema.js";

export type SqlValue = null | number | bigint | string | NodeJS.ArrayBufferView;

export class DirongDatabase {
  readonly db: DatabaseSync;

  constructor(
    readonly dbPath: string,
    busyTimeoutMs: number,
  ) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`PRAGMA busy_timeout = ${Math.trunc(busyTimeoutMs)};`);
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA_SQL);
  }

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const result = fn();
      this.db.exec("COMMIT;");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }
}
