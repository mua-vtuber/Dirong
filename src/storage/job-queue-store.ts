import { existsSync } from "node:fs";
import { AiCleanupJobQueue } from "./ai-cleanup-job-queue.js";
import { ChunkRepository } from "./chunk-repository.js";
import { mapAiCleanupJobRow, mapChunkRow, mapSttJobRow } from "./path-mapping.js";
import type { StoragePathResolver } from "./path-resolver.js";
import { RepairRepository } from "./repair-repository.js";
import { SqlRunner } from "./sql-runner.js";
import { SttJobQueue } from "./stt-job-queue.js";
import { isoNow } from "./store-helpers.js";
import type {
  AiCleanupFailureKind,
  AiCleanupJobRow,
  SttJobRow,
} from "./rows.js";

// JobQueueStore — facade exposing STT + AI-cleanup queue operations.
//
// Behavior preserved verbatim from SessionStore. Notably:
//   - `queueExistingSttJobForChunk` performs an internal `getChunk` read (with
//     path-mapping) before queueing a new STT job — that read stays inside the
//     facade because it's a queue-internal precondition.
//   - `failJobsWithMissingAudio` uses `existsSync` (node:fs) to verify the
//     transcoded audio exists on disk before keeping the job; missing audio is
//     surfaced as a repair item — Rule 2 protective behavior preserved.

export class JobQueueStore {
  private readonly aiCleanupJobs: AiCleanupJobQueue;
  private readonly chunks: ChunkRepository;
  private readonly repairs: RepairRepository;
  private readonly sttJobs: SttJobQueue;

  constructor(
    private readonly sql: SqlRunner,
    private readonly paths: StoragePathResolver,
  ) {
    const repositoryOptions = {
      now: isoNow,
      resolveStoredPath: (filePath: string | null) =>
        this.paths.resolveStoredPath(filePath),
      toStoredPath: (filePath: string | null) =>
        this.paths.toStoredPath(filePath),
    };
    this.aiCleanupJobs = new AiCleanupJobQueue(this.sql, repositoryOptions);
    this.chunks = new ChunkRepository(this.sql, repositoryOptions);
    this.repairs = new RepairRepository(this.sql, repositoryOptions);
    this.sttJobs = new SttJobQueue(this.sql, repositoryOptions);
  }

  // —— STT queue ———————————————————————————————————————————————

  claimNextSttJob(input: {
    workerId: string;
    leaseMs: number;
    sessionId?: string | null;
  }): SttJobRow | null {
    return mapSttJobRow(this.sttJobs.claimNext(input), (filePath) =>
      this.paths.resolveStoredPath(filePath),
    );
  }

  queueExistingSttJobForChunk(chunkId: string, maxAttempts: number): boolean {
    const chunk = mapChunkRow(this.chunks.get(chunkId), (filePath) =>
      this.paths.resolveStoredPath(filePath),
    );
    if (!chunk?.stt_audio_path) {
      return false;
    }

    this.sql.transaction(() => {
      const now = isoNow();
      this.chunks.markExistingSttQueued(chunkId, now);
      this.sttJobs.upsertForChunk(chunk, {
        inputAudioPath: chunk.stt_audio_path ?? "",
        inputAudioSha256: chunk.stt_sha256 ?? chunk.raw_sha256,
        maxAttempts,
        now,
      });
    });

    return true;
  }

  failJobsWithMissingAudio(): number {
    let failed = 0;
    for (const job of this.sttJobs.listNonTerminalWithInputAudio()) {
      const inputAudioPath = this.paths.resolveStoredPath(job.input_audio_path);
      if (inputAudioPath && existsSync(inputAudioPath)) {
        continue;
      }

      const now = isoNow();
      this.sttJobs.markMissingAudio(job.id, now);
      this.repairs.recordItem({
        type: "stt_job_missing_audio",
        sessionId: job.session_id,
        chunkId: job.chunk_id,
        sttJobId: job.id,
        path: inputAudioPath,
        severity: "error",
        details: { previousStatus: job.status },
      });
      failed += 1;
    }

    return failed;
  }

  // —— AI cleanup queue ————————————————————————————————————————

  getOrCreateAiCleanupJob(input: {
    id: string;
    sessionId: string;
    provider: string;
    model: string;
    command: string | null;
    promptVersion: string;
    inputContractVersion: string;
    inputHash: string;
    inputEntryCount: number;
    inputTimelineJsonPath: string | null;
    inputTimelineMarkdownPath: string | null;
    maxAttempts: number;
  }): AiCleanupJobRow {
    return mapAiCleanupJobRow(this.aiCleanupJobs.getOrCreate(input), (filePath) =>
      this.paths.resolveStoredPath(filePath),
    );
  }

  claimAiCleanupJob(input: {
    jobId: string;
    workerId: string;
    leaseMs: number;
  }): AiCleanupJobRow | null {
    return mapAiCleanupJobRow(this.aiCleanupJobs.claim(input), (filePath) =>
      this.paths.resolveStoredPath(filePath),
    );
  }

  updateAiCleanupJobArtifacts(input: {
    jobId: string;
    command?: string | null;
    promptPath?: string | null;
    rawOutputPath?: string | null;
    stderrPath?: string | null;
    parsedJsonPath?: string | null;
    markdownPath?: string | null;
    outputHash?: string | null;
  }): void {
    this.aiCleanupJobs.updateArtifacts(input);
  }

  blockAiCleanupJob(input: {
    jobId: string;
    failureKind: AiCleanupFailureKind;
    error: string;
  }): void {
    this.aiCleanupJobs.block(input);
  }

  retryAiCleanupJob(input: {
    jobId: string;
    nowIso: string;
    maxAttempts: number;
  }): AiCleanupJobRow | null {
    return mapAiCleanupJobRow(
      this.aiCleanupJobs.retryFailed(input),
      (filePath) => this.paths.resolveStoredPath(filePath),
    );
  }

  failProcessingAiCleanupJob(input: {
    jobId: string;
    failureKind: AiCleanupFailureKind;
    error: string;
  }): void {
    this.aiCleanupJobs.failProcessing(input);
  }
}
