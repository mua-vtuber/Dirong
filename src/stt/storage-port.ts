import type { ChunkRow, SttJobRow, TranscriptSegmentRow } from "../storage/rows.js";

export type SttBatchStore = {
  listQueuedSttJobs(input: {
    limit: number;
    sessionId?: string | null;
  }): SttJobRow[];
  releaseExpiredProcessingLeases(nowIso?: string): number;
  claimNextSttJob(input: {
    workerId: string;
    leaseMs: number;
    sessionId?: string | null;
  }): SttJobRow | null;
  markSttJobMissingAudio(job: SttJobRow): void;
  getChunk(chunkId: string): ChunkRow | null;
  listRecentTranscriptTextForSpeaker(input: {
    sessionId: string;
    userId: string;
    beforeStartMs: number;
    limit: number;
    sources?: string[];
  }): string[];
  completeSttJob(input: {
    job: SttJobRow;
    text: string;
    source: string;
    provider: string;
    model: string;
    inputAudioSha256?: string | null;
  }): TranscriptSegmentRow;
  failProcessingSttJob(input: {
    jobId: string;
    error: string;
  }): void;
};
