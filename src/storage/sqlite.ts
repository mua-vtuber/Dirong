import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  applySchemaMigrations,
  listPendingSchemaMigrationIds,
} from "./migrations.js";
import { t } from "../i18n/catalog.js";
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
              t("ko", "runtimeCli.sqlite.migrationBackupFailed"),
              t("ko", "runtimeCli.sqlite.migrationAborted"),
              t("ko", "runtimeCli.sqlite.schemaUnchanged"),
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
