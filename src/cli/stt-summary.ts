import type { SttRunResult } from "../stt/runner.js";

export type SttRunSummaryInput = {
  title: string;
  dbPath: string;
  mode: "dry-run" | "write";
  result: Pick<
    SttRunResult,
    | "limit"
    | "sessionId"
    | "expiredLeasesReleased"
    | "examined"
    | "done"
    | "missingAudio"
    | "failed"
    | "remainingQueuedHint"
    | "samples"
  >;
  detailLines?: readonly string[];
  noteLines?: readonly string[];
  sampleLimit?: number;
};

export function formatSttRunSummary(input: SttRunSummaryInput): string {
  const result = input.result;
  const lines = [
    input.title,
    `DB: ${input.dbPath}`,
    `mode: ${input.mode}`,
    ...(input.detailLines ?? []),
    `limit: ${result.limit}`,
    `session: ${result.sessionId ?? "all"}`,
    `expired leases released: ${result.expiredLeasesReleased}`,
    `examined: ${result.examined}`,
    `done: ${result.done}`,
    `missing audio: ${result.missingAudio}`,
    `failed: ${result.failed}`,
    `more queued jobs hint: ${result.remainingQueuedHint > 0 ? "yes" : "no"}`,
    ...(input.noteLines ?? []),
    "",
    "samples:",
    JSON.stringify(result.samples.slice(0, input.sampleLimit ?? 10), null, 2),
  ];
  return lines.join("\n");
}

export type SqliteBackupPrintOptions = {
  missingDatabaseMessage?: string;
  writeLine?: (line: string) => void;
};

export function printSqliteBackupSummary(
  backupPaths: readonly string[],
  options: SqliteBackupPrintOptions = {},
): void {
  const writeLine = options.writeLine ?? ((line: string) => console.log(line));

  if (backupPaths.length > 0) {
    writeLine("SQLite snapshot backup 생성:");
    for (const backupPath of backupPaths) {
      writeLine(`- ${backupPath}`);
    }
    writeLine("");
    return;
  }

  if (options.missingDatabaseMessage) {
    writeLine(options.missingDatabaseMessage);
    writeLine("");
  }
}
