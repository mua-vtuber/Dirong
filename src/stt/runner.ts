import { existsSync } from "node:fs";
import { redactSensitiveText } from "../errors.js";
import { sha256File } from "../media.js";
import type { SessionStore } from "../storage/session-store.js";
import type { SttProvider } from "./provider.js";

export type SttRunOptions = {
  workerId: string;
  limit: number;
  sessionId?: string | null;
  leaseMs: number;
  dryRun: boolean;
  source: string;
  provider: SttProvider;
  language?: string | null;
  timeoutMs?: number;
  contextSegments?: number;
};

export type SttRunResult = {
  workerId: string;
  dryRun: boolean;
  limit: number;
  sessionId: string | null;
  source: string;
  provider: string;
  model: string;
  language: string | null;
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
    inputAudioPath?: string;
    text?: string;
    error?: string;
  }>;
};

export async function runSttBatch(
  store: SessionStore,
  options: SttRunOptions,
): Promise<SttRunResult> {
  const result: SttRunResult = {
    workerId: options.workerId,
    dryRun: options.dryRun,
    limit: options.limit,
    sessionId: options.sessionId ?? null,
    source: options.source,
    provider: options.provider.providerName,
    model: options.provider.modelName,
    language: options.language ?? null,
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
        status: audioExists ? "would_transcribe" : "would_failed_missing_file",
        inputAudioPath: job.input_audio_path,
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
        inputAudioPath: job.input_audio_path,
        error: "input audio file missing",
      });
      continue;
    }

    try {
      const chunk = store.getChunk(job.chunk_id);
      if (!chunk) {
        throw new Error(`STT job의 chunk를 찾지 못했습니다: ${job.chunk_id}`);
      }

      const prompt = options.provider.supportsPrompt
        ? buildTrailingPrompt(store.listRecentTranscriptTextForSpeaker({
            sessionId: job.session_id,
            userId: job.user_id,
            beforeStartMs: chunk.started_at_ms,
            limit: options.contextSegments ?? 2,
            sources: ["real", "stt"],
          }))
        : null;

      const inputAudioSha256 =
        job.input_audio_sha256 ?? (await sha256File(job.input_audio_path));
      const transcription = await options.provider.transcribe(
        job.input_audio_path,
        {
          language: options.language ?? null,
          prompt,
          sessionId: job.session_id,
          chunkId: job.chunk_id,
          userId: job.user_id,
          displayName: job.display_name_snapshot,
        },
        { timeoutMs: options.timeoutMs },
      );

      const segment = store.completeSttJob({
        job,
        text: transcription.text,
        source: options.source,
        provider: options.provider.providerName,
        model: options.provider.modelName,
        inputAudioSha256,
      });
      result.done += 1;
      result.samples.push({
        jobId: job.id,
        chunkId: job.chunk_id,
        speaker: job.display_name_snapshot,
        status: "done",
        inputAudioPath: job.input_audio_path,
        text: segment.text,
      });
    } catch (error) {
      const message = summarizeError(error);
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
        inputAudioPath: job.input_audio_path,
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

function buildTrailingPrompt(texts: string[]): string | null {
  if (texts.length === 0) {
    return null;
  }

  const joined = texts.join("\n").trim();
  if (joined.length === 0) {
    return null;
  }

  return joined.length <= 1200 ? joined : joined.slice(-1200);
}

function summarizeError(error: unknown): string {
  const message = redactSensitiveText(
    error instanceof Error ? error.message : String(error),
  );
  return message.length <= 1000 ? message : `${message.slice(0, 1000)}...`;
}
