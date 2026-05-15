import { JobQueueStore } from "./job-queue-store.js";
import { createStoragePathResolver } from "./path-resolver.js";
import { RuntimeStateStore } from "./runtime-state-store.js";
import { SessionReadStore } from "./session-read-store.js";
import { SessionWriteStore } from "./session-write-store.js";
import { SqlRunner } from "./sql-runner.js";
import type { DirongDatabase } from "./sqlite.js";

// Re-export the row + status types that callers historically imported from the
// legacy SessionStore module. Wave 3 redirected every consumer to
// `storage-context.js` and deleted the old file; this re-export keeps Wave 3 a
// rename, not a behavioral edit. List matches the prior re-export list
// LINE-FOR-LINE.
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

// Wave 3 advisory A2 resolution: the previously-exported `RepairScanStore`
// composite type (= SessionWriteStore & SessionReadStore & RuntimeStateStore)
// was dead code — `repair-scan.ts` also consumes JobQueueStore methods
// (`failJobsWithMissingAudio`, `queueExistingSttJobForChunk`) and was therefore
// retyped against the full `StorageContext`. The narrower composite has been
// removed to avoid shipping a misleading dead type. If a future caller wants a
// narrower bundle, it can compose `Pick<StorageContext, ...>` at the call site.

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

// Flat storage adapter exposing every facade method on a single object. This
// exists ONLY because the existing narrow port interfaces (`RecordingProducerStore`,
// `DashboardStore`, `AiCleanupAutomationStore`, `SttBatchStore`, etc.) were
// authored against the legacy `SessionStore` flat surface — they require flat
// methods like `getSession` / `createSession` / `claimNextSttJob` rather than
// the nested `ctx.reads.getSession(...)` shape. Until those narrow ports are
// updated to accept the facade-shaped context (a future plan — POLY), production
// construction sites that hand a store to a service-class constructor build a
// flat adapter via this helper. Each method is `.bind(facade)` so `this` stays
// bound and the original signature is preserved; no behavior is added or
// removed.
//
// Tests that exercise the facade contract directly should NOT use this helper —
// they call `ctx.writes.X(...)` / `ctx.reads.X(...)` directly per the plan.
// Structural shape of the flat adapter. Defined via per-facade `Pick`s so the
// resulting type lists only PUBLIC methods — intersecting the class types
// directly would collapse to `never` because each facade has its own private
// repository slots (`private readonly aiCleanupJobs`, etc.). `Pick<C, keyof C>`
// strips private/protected members because TypeScript's `keyof` only enumerates
// public properties.
type WriteMethods = Pick<SessionWriteStore, keyof SessionWriteStore>;
type ReadMethods = Pick<SessionReadStore, keyof SessionReadStore>;
type JobMethods = Pick<JobQueueStore, keyof JobQueueStore>;
type RuntimeMethods = Pick<RuntimeStateStore, keyof RuntimeStateStore>;

export type FlatStorageStore = WriteMethods &
  ReadMethods &
  JobMethods &
  RuntimeMethods & {
    close(): void;
    database: DirongDatabase;
  };

export function flattenStorageContext(ctx: StorageContext): FlatStorageStore {
  const { writes, reads, jobs, runtime } = ctx;
  return {
    // —— SessionWriteStore ——
    createSession: writes.createSession.bind(writes),
    updateSessionStatus: writes.updateSessionStatus.bind(writes),
    stopSession: writes.stopSession.bind(writes),
    upsertSpeaker: writes.upsertSpeaker.bind(writes),
    createChunkWriting: writes.createChunkWriting.bind(writes),
    finalizeRawChunk: writes.finalizeRawChunk.bind(writes),
    completeChunkTranscodeAndQueueJob:
      writes.completeChunkTranscodeAndQueueJob.bind(writes),
    markChunkTranscodeFailed: writes.markChunkTranscodeFailed.bind(writes),
    markChunkFailed: writes.markChunkFailed.bind(writes),
    recordConnectionEvent: writes.recordConnectionEvent.bind(writes),
    recordRepairItem: writes.recordRepairItem.bind(writes),
    completeFakeSttJob: writes.completeFakeSttJob.bind(writes),
    completeSttJob: writes.completeSttJob.bind(writes),
    markSttJobMissingAudio: writes.markSttJobMissingAudio.bind(writes),
    failProcessingSttJob: writes.failProcessingSttJob.bind(writes),
    completeAiCleanupJob: writes.completeAiCleanupJob.bind(writes),
    // —— SessionReadStore ——
    getSession: reads.getSession.bind(reads),
    getLatestSession: reads.getLatestSession.bind(reads),
    listFinalizedSessionsForAiCleanupAutomation:
      reads.listFinalizedSessionsForAiCleanupAutomation.bind(reads),
    getChunk: reads.getChunk.bind(reads),
    listChunksMissingSttJob: reads.listChunksMissingSttJob.bind(reads),
    listWritingChunks: reads.listWritingChunks.bind(reads),
    hasChunkAudioPath: reads.hasChunkAudioPath.bind(reads),
    getAudioPathForChunk: reads.getAudioPathForChunk.bind(reads),
    listRecentTranscriptSegments: reads.listRecentTranscriptSegments.bind(reads),
    listTranscriptTimelineSegments:
      reads.listTranscriptTimelineSegments.bind(reads),
    listRecentTranscriptTextForSpeaker:
      reads.listRecentTranscriptTextForSpeaker.bind(reads),
    listQueuedSttJobs: reads.listQueuedSttJobs.bind(reads),
    getAiCleanupJob: reads.getAiCleanupJob.bind(reads),
    getAiCleanupJobByIdentity: reads.getAiCleanupJobByIdentity.bind(reads),
    listRecentAiCleanupJobs: reads.listRecentAiCleanupJobs.bind(reads),
    getLatestMeetingNotesDraft: reads.getLatestMeetingNotesDraft.bind(reads),
    getMeetingNotesDraftByJobId: reads.getMeetingNotesDraftByJobId.bind(reads),
    getAiCleanupSttTerminalSnapshot:
      reads.getAiCleanupSttTerminalSnapshot.bind(reads),
    getDashboardState: reads.getDashboardState.bind(reads),
    statusText: reads.statusText.bind(reads),
    // —— JobQueueStore ——
    claimNextSttJob: jobs.claimNextSttJob.bind(jobs),
    queueExistingSttJobForChunk: jobs.queueExistingSttJobForChunk.bind(jobs),
    failJobsWithMissingAudio: jobs.failJobsWithMissingAudio.bind(jobs),
    getOrCreateAiCleanupJob: jobs.getOrCreateAiCleanupJob.bind(jobs),
    claimAiCleanupJob: jobs.claimAiCleanupJob.bind(jobs),
    updateAiCleanupJobArtifacts: jobs.updateAiCleanupJobArtifacts.bind(jobs),
    blockAiCleanupJob: jobs.blockAiCleanupJob.bind(jobs),
    retryAiCleanupJob: jobs.retryAiCleanupJob.bind(jobs),
    failProcessingAiCleanupJob: jobs.failProcessingAiCleanupJob.bind(jobs),
    // —— RuntimeStateStore ——
    releaseExpiredProcessingLeases:
      runtime.releaseExpiredProcessingLeases.bind(runtime),
    releaseExpiredAiCleanupLeases:
      runtime.releaseExpiredAiCleanupLeases.bind(runtime),
    repairExpiredAiCleanupProcessingJobs:
      runtime.repairExpiredAiCleanupProcessingJobs.bind(runtime),
    normalizeStoredPaths: runtime.normalizeStoredPaths.bind(runtime),
    // —— escape hatch ——
    database: ctx.database,
    close: () => ctx.close(),
  } as FlatStorageStore;
}
