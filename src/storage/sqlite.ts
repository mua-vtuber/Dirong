import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  applySchemaMigrations,
  listPendingSchemaMigrationIds,
} from "./migrations.js";
import { SCHEMA_SQL } from "./schema.js";
import { SqlRunner } from "./sql-runner.js";
import { backupOpenDatabaseSnapshot } from "./sqlite-backup.js";

export type SqlValue = null | number | bigint | string | NodeJS.ArrayBufferView;

export class DirongDatabase {
  readonly db: DatabaseSync;

  constructor(
    readonly dbPath: string,
    busyTimeoutMs: number,
    options?: {
      readOnly?: boolean;
      migrationBackup?: false | { targetPath?: string };
    },
  ) {
    const databaseExisted = existsSync(dbPath);
    if (!options?.readOnly) {
      mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath, { readOnly: options?.readOnly ?? false });
    try {
      this.db.exec(`PRAGMA busy_timeout = ${Math.trunc(busyTimeoutMs)};`);
      this.db.exec("PRAGMA foreign_keys = ON;");
      if (!options?.readOnly) {
        const pendingMigrationIds = listPendingSchemaMigrationIds(this.db);
        if (
          databaseExisted &&
          pendingMigrationIds.length > 0 &&
          options?.migrationBackup !== false
        ) {
          backupOpenDatabaseSnapshot(this.db, dbPath, {
            busyTimeoutMs,
            targetPath: options?.migrationBackup?.targetPath,
            failureMessageLines: [
              "SQLite migration backup 생성에 실패했습니다.",
              "migration을 적용하지 않고 시작을 중단합니다.",
              "backup이 실패했으므로 DB schema는 변경하지 않았습니다.",
            ],
          });
        }
        this.db.exec("PRAGMA journal_mode = WAL;");
        this.db.exec(SCHEMA_SQL);
        const sqlRunner = new SqlRunner(this);
        applySchemaMigrations(sqlRunner);
      }
    } catch (error) {
      this.db.close();
      throw error;
    }
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
