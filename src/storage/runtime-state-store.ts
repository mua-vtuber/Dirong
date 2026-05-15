import { AiCleanupJobQueue } from "./ai-cleanup-job-queue.js";
import type { StoragePathResolver } from "./path-resolver.js";
import { RepairRepository } from "./repair-repository.js";
import { SqlRunner } from "./sql-runner.js";
import type { DirongDatabase } from "./sqlite.js";
import { SttJobQueue } from "./stt-job-queue.js";
import { isoNow } from "./store-helpers.js";
import type { AiCleanupLeaseRepairSummary } from "./rows.js";

// RuntimeStateStore — facade exposing recording-runtime / lease-repair operations
// plus the one-shot `normalizeStoredPaths` sweep that historically ran from the
// SessionStore constructor when `options.normalizeStoredPaths === true`.
//
// `normalizeStoredPaths` walks every path column in every table and rewrites
// absolute paths to storage-root-relative form. It uses `database.transaction`
// directly (NOT `sql.transaction`) because the bulk update walks an unbounded
// number of rows and we need a single BEGIN IMMEDIATE around the whole sweep —
// behavior preserved BYTE-IDENTICAL from session-store.ts lines 712-761.

export class RuntimeStateStore {
  private readonly aiCleanupJobs: AiCleanupJobQueue;
  private readonly repairs: RepairRepository;
  private readonly sttJobs: SttJobQueue;

  constructor(
    private readonly sql: SqlRunner,
    private readonly paths: StoragePathResolver,
    private readonly database: DirongDatabase,
  ) {
    const repositoryOptions = {
      now: isoNow,
      resolveStoredPath: (filePath: string | null) =>
        this.paths.resolveStoredPath(filePath),
      toStoredPath: (filePath: string | null) =>
        this.paths.toStoredPath(filePath),
    };
    this.aiCleanupJobs = new AiCleanupJobQueue(this.sql, repositoryOptions);
    this.repairs = new RepairRepository(this.sql, repositoryOptions);
    this.sttJobs = new SttJobQueue(this.sql, repositoryOptions);
  }

  // —— STT lease repair ———————————————————————————————————————

  releaseExpiredProcessingLeases(nowIso = isoNow()): number {
    const jobs = this.sttJobs.listExpiredProcessingLeases(nowIso);
    for (const job of jobs) {
      this.sttJobs.requeueExpiredProcessingLease(job.id, nowIso);
      this.repairs.recordItem({
        type: "expired_processing_lease_requeued",
        status: "repaired",
        severity: "info",
        sessionId: job.session_id,
        chunkId: job.chunk_id,
        sttJobId: job.id,
        details: {
          previousLockedBy: job.locked_by,
          previousLockedUntil: job.locked_until,
        },
      });
    }

    return jobs.length;
  }

  // —— AI cleanup lease repair ————————————————————————————————

  releaseExpiredAiCleanupLeases(nowIso = isoNow()): number {
    return this.aiCleanupJobs.releaseExpiredLeases(nowIso);
  }

  repairExpiredAiCleanupProcessingJobs(
    nowIso = isoNow(),
  ): AiCleanupLeaseRepairSummary {
    return this.aiCleanupJobs.repairExpiredProcessingJobs(nowIso);
  }

  // —— startup path-normalization sweep ————————————————————————

  normalizeStoredPaths(): void {
    const pathColumns: Array<{ table: string; columns: string[] }> = [
      { table: "sessions", columns: ["data_dir"] },
      { table: "chunks", columns: ["raw_audio_path", "stt_audio_path"] },
      { table: "stt_jobs", columns: ["input_audio_path"] },
      {
        table: "ai_cleanup_jobs",
        columns: [
          "input_timeline_json_path",
          "input_timeline_markdown_path",
          "prompt_path",
          "raw_output_path",
          "stderr_path",
          "parsed_json_path",
          "markdown_path",
        ],
      },
      {
        table: "meeting_notes_drafts",
        columns: ["json_path", "markdown_path", "raw_output_path"],
      },
      { table: "repair_items", columns: ["path"] },
    ];

    this.database.transaction(() => {
      for (const { table, columns } of pathColumns) {
        const rowIds = this.sql.all<{ row_id: number }>(
          `SELECT rowid AS row_id FROM ${table}`,
        );
        for (const { row_id: rowId } of rowIds) {
          for (const column of columns) {
            const row = this.sql.get<{ value: string | null }>(
              `SELECT ${column} AS value FROM ${table} WHERE rowid = ?`,
              rowId,
            );
            const storedPath = this.paths.toStoredPath(row?.value ?? null);
            if (storedPath === (row?.value ?? null)) {
              continue;
            }
            this.sql.run(
              `UPDATE ${table} SET ${column} = ? WHERE rowid = ?`,
              storedPath,
              rowId,
            );
          }
        }
      }
    });
    this.repairs.normalizeDedupeKeys();
  }
}
