import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { DirongError, redactSensitiveText } from "../errors.js";

export type SqliteBackupOptions = {
  busyTimeoutMs: number;
  targetPath?: string;
  failureMessageLines?: readonly string[];
};

const DEFAULT_FAILURE_MESSAGE_LINES = [
  "SQLite backup 생성에 실패했습니다.",
  "녹음 중이면 잠시 후 다시 시도해 주세요.",
  "backup이 실패했으므로 STT job은 claim하지 않았고 attempts도 증가하지 않았습니다.",
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
