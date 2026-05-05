import { existsSync } from "node:fs";
import type { SessionStore, SttJobRow } from "../storage/session-store.js";

export type FakeSttRunOptions = {
  workerId: string;
  limit: number;
  sessionId?: string | null;
  leaseMs: number;
  dryRun: boolean;
};

export type FakeSttRunResult = {
  workerId: string;
  dryRun: boolean;
  limit: number;
  sessionId: string | null;
  expiredLeasesReleased: number;
  examined: number;
  done: number;
  missingAudio: number;
  failed: number;
  remainingQueuedHint: number;
  samples: Array<{
    jobId: string;
    chunkId: string;
    speaker: string;
    status: string;
    text?: string;
    error?: string;
  }>;
};

export async function runFakeSttBatch(
  store: SessionStore,
  options: FakeSttRunOptions,
): Promise<FakeSttRunResult> {
  const result: FakeSttRunResult = {
    workerId: options.workerId,
    dryRun: options.dryRun,
    limit: options.limit,
    sessionId: options.sessionId ?? null,
    expiredLeasesReleased: 0,
    examined: 0,
    done: 0,
    missingAudio: 0,
    failed: 0,
    remainingQueuedHint: 0,
    samples: [],
  };

  if (options.dryRun) {
    const jobs = store.listQueuedSttJobs({
      limit: options.limit,
      sessionId: options.sessionId,
    });
    for (const job of jobs) {
      result.examined += 1;
      const audioExists = existsSync(job.input_audio_path);
      result.samples.push({
        jobId: job.id,
        chunkId: job.chunk_id,
        speaker: job.display_name_snapshot,
        status: audioExists ? "would_done" : "would_failed_missing_file",
      });
    }
    result.remainingQueuedHint = jobs.length === options.limit ? 1 : 0;
    return result;
  }

  result.expiredLeasesReleased = store.releaseExpiredProcessingLeases();

  for (let index = 0; index < options.limit; index += 1) {
    const job = store.claimNextSttJob({
      workerId: options.workerId,
      leaseMs: options.leaseMs,
      sessionId: options.sessionId,
    });
    if (!job) {
      break;
    }

    result.examined += 1;

    if (!existsSync(job.input_audio_path)) {
      store.markSttJobMissingAudio(job);
      result.missingAudio += 1;
      result.samples.push({
        jobId: job.id,
        chunkId: job.chunk_id,
        speaker: job.display_name_snapshot,
        status: "failed_missing_file",
        error: "input audio file missing",
      });
      continue;
    }

    try {
      const text = createFakeTranscript(job);
      store.completeFakeSttJob({ job, text });
      result.done += 1;
      result.samples.push({
        jobId: job.id,
        chunkId: job.chunk_id,
        speaker: job.display_name_snapshot,
        status: "done",
        text,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      store.failProcessingSttJob({
        jobId: job.id,
        error: message,
      });
      result.failed += 1;
      result.samples.push({
        jobId: job.id,
        chunkId: job.chunk_id,
        speaker: job.display_name_snapshot,
        status: "failed",
        error: message,
      });
    }
  }

  result.remainingQueuedHint = store.listQueuedSttJobs({
    limit: 1,
    sessionId: options.sessionId,
  }).length;

  return result;
}

function createFakeTranscript(job: SttJobRow): string {
  return [
    "[FAKE STT]",
    `${job.display_name_snapshot} speaker chunk`,
    `chunk=${job.chunk_id}`,
    "Real STT is intentionally not called in Phase 2.",
  ].join(" ");
}
