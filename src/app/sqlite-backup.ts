import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

export function backupDatabaseFiles(dbPath: string): string[] {
  if (!existsSync(dbPath)) {
    return [];
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupBase = `${dbPath}.backup-${stamp}`;
  const copied: string[] = [];

  for (const suffix of ["", "-wal", "-shm"]) {
    const source = `${dbPath}${suffix}`;
    if (!existsSync(source)) {
      continue;
    }
    const target = `${backupBase}${suffix ? suffix : ".sqlite"}`;
    copyFileSync(source, target);
    copied.push(path.relative(process.cwd(), target).replace(/\\/g, "/"));
  }

  return copied;
}
