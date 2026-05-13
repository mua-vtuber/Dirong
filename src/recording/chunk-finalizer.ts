import { existsSync } from "node:fs";
import { rename, stat } from "node:fs/promises";
import { safeErrorInfo } from "../errors.js";
import { sha256File, transcodeToSttSafe, validatePlayable } from "../media.js";
import type { ChunkFinalizerStore } from "./storage-port.js";

export type ChunkFinalizerOptions = {
  sttMaxAttempts: number;
  sttSafeFormat: "webm" | "wav";
};

export type FinalizableSession = {
  sessionId: string;
  sttAudioDir: string;
  startedAtMs: number;
  ffmpegPath: string;
};

export type FinalizableChunk = {
  chunkId: string;
  userId: string;
  displayNameSnapshot: string;
  startedAtMs: number;
  rawPartPath: string;
  rawFinalPath: string;
  baseName: string;
};

export class ChunkFinalizer {
  constructor(
    private readonly store: ChunkFinalizerStore,
    private readonly options: ChunkFinalizerOptions,
  ) {}

  async finalize(
    active: FinalizableSession,
    chunk: FinalizableChunk,
    closeReason: string,
    pipelineError: unknown,
  ): Promise<void> {
    const endedAtMs = Date.now() - active.startedAtMs;
    const rawExists = existsSync(chunk.rawPartPath) || existsSync(chunk.rawFinalPath);

    if (!rawExists) {
      this.store.markChunkFailed({
        chunkId: chunk.chunkId,
        error: { message: "chunk 파일이 생성되지 않았습니다.", pipelineError },
      });
      this.store.recordRepairItem({
        type: "chunk_audio_missing_after_write",
        sessionId: active.sessionId,
        chunkId: chunk.chunkId,
        path: chunk.rawPartPath,
        severity: "error",
      });
      return;
    }

    if (existsSync(chunk.rawPartPath) && !existsSync(chunk.rawFinalPath)) {
      await rename(chunk.rawPartPath, chunk.rawFinalPath);
    }

    const rawStat = await stat(chunk.rawFinalPath);
    const rawPlayback = await validatePlayable(chunk.rawFinalPath, active.ffmpegPath);
    const rawSha256 = rawStat.size > 0 ? await sha256File(chunk.rawFinalPath) : null;
    const durationMs = Math.max(0, endedAtMs - chunk.startedAtMs);

    this.store.finalizeRawChunk({
      chunkId: chunk.chunkId,
      endedAtMs,
      durationMs,
      rawByteSize: rawStat.size,
      rawSha256,
      closeReason,
      pipelineError,
    });

    if (rawStat.size === 0 || !rawPlayback.ok) {
      this.store.markChunkTranscodeFailed({
        chunkId: chunk.chunkId,
        error: rawPlayback.error ?? "raw audio playback validation failed",
      });
      this.store.recordRepairItem({
        type: "raw_audio_not_playable",
        sessionId: active.sessionId,
        chunkId: chunk.chunkId,
        path: chunk.rawFinalPath,
        severity: "error",
        details: { rawByteSize: rawStat.size, rawPlaybackError: rawPlayback.error },
      });
      return;
    }

    const transcode = await transcodeToSttSafe(
      chunk.rawFinalPath,
      active.sttAudioDir,
      chunk.baseName,
      this.options.sttSafeFormat,
      active.ffmpegPath,
    );

    if (!transcode.playbackChecked || transcode.byteSize === 0) {
      this.store.markChunkTranscodeFailed({
        chunkId: chunk.chunkId,
        error: transcode.error ?? "STT-safe transcode validation failed",
      });
      this.store.recordRepairItem({
        type: "stt_transcode_failed",
        sessionId: active.sessionId,
        chunkId: chunk.chunkId,
        path: transcode.outputPath,
        severity: "error",
        details: {
          format: transcode.format,
          byteSize: transcode.byteSize,
          error: transcode.error,
        },
      });
      return;
    }

    const sttSha256 = await sha256File(transcode.outputPath);
    this.store.completeChunkTranscodeAndQueueJob({
      chunkId: chunk.chunkId,
      sttAudioPath: transcode.outputPath,
      sttAudioFormat: transcode.format,
      sttByteSize: transcode.byteSize,
      sttSha256,
      maxAttempts: this.options.sttMaxAttempts,
    });

    this.store.recordConnectionEvent({
      sessionId: active.sessionId,
      eventType: "chunk_finalized_and_queued",
      endedAtMs,
      details: {
        chunkId: chunk.chunkId,
        userId: chunk.userId,
        displayNameSnapshot: chunk.displayNameSnapshot,
        rawAudioPath: chunk.rawFinalPath,
        rawByteSize: rawStat.size,
        rawSha256,
        sttAudioPath: transcode.outputPath,
        sttAudioFormat: transcode.format,
        sttByteSize: transcode.byteSize,
        sttSha256,
        durationMs,
        closeReason,
      },
    });
  }

  recordFailure(input: {
    sessionId: string;
    chunkId: string;
    rawFinalPath: string;
    error: unknown;
  }): void {
    const errorInfo = safeErrorInfo(input.error);
    this.store.markChunkFailed({
      chunkId: input.chunkId,
      error: errorInfo,
    });
    this.store.recordRepairItem({
      type: "chunk_finalize_failed",
      sessionId: input.sessionId,
      chunkId: input.chunkId,
      path: input.rawFinalPath,
      severity: "error",
      details: errorInfo,
    });
    this.store.recordConnectionEvent({
      sessionId: input.sessionId,
      eventType: "chunk_finalize_failed",
      level: "error",
      details: { chunkId: input.chunkId, error: errorInfo },
    });
  }
}
