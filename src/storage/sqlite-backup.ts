import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { DirongError, redactSensitiveText } from "../errors.js";
import { t } from "../i18n/catalog.js";

export type SqliteBackupOptions = {
  busyTimeoutMs: number;
  targetPath?: string;
  failureMessageLines?: readonly string[];
};

const DEFAULT_FAILURE_MESSAGE_LINES = [
  t("ko", "runtimeCli.sqlite.backupFailed"),
  t("ko", "runtimeCli.sqlite.recordingRetry"),
  t("ko", "runtimeCli.sqlite.sttNotClaimed"),
] as const;

export function backupDatabaseSnapshot(
  dbPath: string,
  options: SqliteBackupOptions,
): string[] {
  if (!existsSync(dbPath)) {
    return [];
  }

  const database = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return backupOpenDatabaseSnapshot(database, dbPath, options);
  } finally {
    database.close();
  }
}

export function backupOpenDatabaseSnapshot(
  database: DatabaseSync,
  dbPath: string,
  options: SqliteBackupOptions,
): string[] {
  if (!existsSync(dbPath)) {
    return [];
  }

  const target = options.targetPath ?? makeBackupPath(dbPath);
  if (existsSync(target)) {
    throw backupFailure(
      `SQLite backup target already exists: ${relativeDisplayPath(target)}`,
      options.failureMessageLines,
    );
  }

  try {
    database.exec(`PRAGMA busy_timeout = ${Math.trunc(options.busyTimeoutMs)};`);
    database.exec(`VACUUM main INTO ${sqlStringLiteral(target)};`);
  } catch (error) {
    throw backupFailure(
      error instanceof Error ? error.message : String(error),
      options.failureMessageLines,
    );
  }

  return [relativeDisplayPath(target)];
}

function makeBackupPath(dbPath: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${dbPath}.backup-${stamp}-${process.pid}.sqlite`;
}

function sqlStringLiteral(value: string): string {
  return `'${path.resolve(value).replace(/'/g, "''")}'`;
}

function backupFailure(
  reason: string,
  messageLines: readonly string[] = DEFAULT_FAILURE_MESSAGE_LINES,
): DirongError {
  return new DirongError(
    "SQLITE_BACKUP_FAILED",
    [...messageLines, redactSensitiveText(reason)].join(" "),
  );
}

function relativeDisplayPath(filePath: string): string {
  return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
}
