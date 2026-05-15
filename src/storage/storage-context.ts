import { JobQueueStore } from "./job-queue-store.js";
import { createStoragePathResolver } from "./path-resolver.js";
import { RuntimeStateStore } from "./runtime-state-store.js";
import { SessionReadStore } from "./session-read-store.js";
import { SessionWriteStore } from "./session-write-store.js";
import { SqlRunner } from "./sql-runner.js";
import type { DirongDatabase } from "./sqlite.js";

// Re-export the row + status types that callers historically imported from
// session-store.ts. Wave 3 redirects every consumer to `storage-context.js` so
// the legacy file can be deleted; this re-export keeps Wave 3 a rename, not a
// behavioral edit. List matches session-store.ts:37-53 LINE-FOR-LINE.
export type {
  AiCleanupFailureKind,
  AiCleanupJobRow,
  AiCleanupJobStatus,
  AiCleanupLeaseRepairSummary,
  AiCleanupSttTerminalSnapshot,
  ChunkRow,
  ChunkStatus,
  MeetingNotesDraftRow,
  RecordingRuntimeState,
  RepairScanSummary,
  SessionRow,
  SessionStatus,
  SpeechStatus,
  SttJobRow,
  TranscriptSegmentRow,
} from "./rows.js";

export type StorageContextOptions = {
  storageRoot?: string | null;
  normalizeStoredPaths?: boolean;
};

export type StorageContext = {
  writes: SessionWriteStore;
  reads: SessionReadStore;
  jobs: JobQueueStore;
  runtime: RuntimeStateStore;
  // `database` is exposed for callers that legitimately need DirongDatabase
  // (dashboard read model uses its raw `db` for ad-hoc SELECTs). Treat as an
  // escape hatch — prefer the facades for new code.
  database: DirongDatabase;
  close(): void;
};

// Composite type for Wave 3's repair-scan.ts redirect. NOTE: the executor
// advisory A2 flagged that repair-scan.ts ALSO consumes JobQueueStore methods
// (`failJobsWithMissingAudio`, `queueExistingSttJobForChunk`); Wave 3 will
// resolve that by typing repair-scan against the full `StorageContext` instead.
// `RepairScanStore` is preserved here per the Wave 2 plan contract — Wave 3
// owns the call-site decision.
export type RepairScanStore = SessionWriteStore &
  SessionReadStore &
  RuntimeStateStore;

// Composition root. Constructs ONE SqlRunner + ONE StoragePathResolver and
// threads them through every facade per the CONTEXT.md lock ("facades share a
// single SqlRunner instance per DirongDatabase"). This is the SOLE construction
// surface; production code must not instantiate facades directly.
export function createStorageContext(
  database: DirongDatabase,
  options?: StorageContextOptions,
): StorageContext {
  const paths = createStoragePathResolver(options?.storageRoot);
  const sql = new SqlRunner(database);

  const writes = new SessionWriteStore(sql, paths);
  const reads = new SessionReadStore(sql, paths, database);
  const jobs = new JobQueueStore(sql, paths);
  const runtime = new RuntimeStateStore(sql, paths, database);

  if (options?.normalizeStoredPaths === true && paths.storageRoot) {
    runtime.normalizeStoredPaths();
  }

  return {
    writes,
    reads,
    jobs,
    runtime,
    database,
    close(): void {
      database.close();
    },
  };
}
