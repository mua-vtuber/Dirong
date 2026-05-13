import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { Phase1Config } from "../config.js";
import { resolveFfmpegPath, sha256File, transcodeToSttSafe } from "../media.js";
import type { ChunkRow, RepairScanSummary } from "./rows.js";
import type { SessionStore } from "./session-store.js";

export async function runStartupRepair(
  store: SessionStore,
  config: Phase1Config,
): Promise<RepairScanSummary> {
  const summary: RepairScanSummary = {
    oldPartFiles: 0,
    staleWritingChunksRepaired: 0,
    staleWritingChunksFailed: 0,
    missingSttJobsCreated: 0,
    missingAudioJobsFailed: 0,
    expiredLeasesReleased: 0,
    orphanAudioFiles: 0,
  };

  summary.oldPartFiles = scanOldPartFiles(store, config);
  const writingSummary = await repairStaleWritingChunks(store, config);
  summary.staleWritingChunksRepaired = writingSummary.repaired;
  summary.staleWritingChunksFailed = writingSummary.failed;
  summary.missingSttJobsCreated = await repairChunksMissingSttJobs(store, config);
  summary.missingAudioJobsFailed = store.failJobsWithMissingAudio();
  summary.expiredLeasesReleased = store.releaseExpiredProcessingLeases();
  summary.orphanAudioFiles = scanOrphanAudioFiles(store, config.dataDir);

  return summary;
}

function scanOldPartFiles(store: SessionStore, config: Phase1Config): number {
  if (!existsSync(config.dataDir)) {
    return 0;
  }

  const now = Date.now();
  let count = 0;
  for (const filePath of walkFiles(config.dataDir)) {
    if (!filePath.endsWith(".part.ogg")) {
      continue;
    }

    const fileStat = statSync(filePath);
    const ageMs = now - fileStat.mtimeMs;
    if (ageMs < config.partRepairAgeMs) {
      continue;
    }

    store.recordRepairItem({
      type: "old_part_file",
      severity: "warn",
      sessionId: inferSessionId(config.dataDir, filePath),
      path: filePath,
      details: {
        ageMs: Math.trunc(ageMs),
        size: fileStat.size,
        action: "수동 확인 후 보존/삭제를 결정하세요.",
      },
    });
    count += 1;
  }

  return count;
}

async function repairStaleWritingChunks(
  store: SessionStore,
  config: Phase1Config,
): Promise<{ repaired: number; failed: number }> {
  const chunks = store.listWritingChunks();
  if (chunks.length === 0) {
    return { repaired: 0, failed: 0 };
  }

  const ffmpeg = await resolveFfmpegPath();
  let repaired = 0;
  let failed = 0;

  for (const chunk of chunks) {
    if (!isOlderThan(chunk.updated_at, config.partRepairAgeMs)) {
      continue;
    }

    const partPath = partPathForRawPath(chunk.raw_audio_path);
    if (existsSync(chunk.raw_audio_path)) {
      const rawStat = statSync(chunk.raw_audio_path);
      const session = store.getSession(chunk.session_id);
      const endedAtMs = estimateEndedAtMs(chunk, session?.started_at ?? null, rawStat.mtimeMs);
      const rawSha256 = rawStat.size > 0 ? await sha256File(chunk.raw_audio_path) : null;

      store.finalizeRawChunk({
        chunkId: chunk.id,
        endedAtMs,
        durationMs: Math.max(0, endedAtMs - chunk.started_at_ms),
        rawByteSize: rawStat.size,
        rawSha256,
        closeReason: "startup_repair_stale_writing_final_file",
        pipelineError: { repairedBy: "startup_repair" },
      });

      if (!ffmpeg.path) {
        store.markChunkTranscodeFailed({
          chunkId: chunk.id,
          error: "startup repair에 필요한 FFmpeg가 없습니다.",
        });
        store.updateSessionStatus(chunk.session_id, "needs_repair");
        store.recordRepairItem({
          type: "stale_writing_chunk_no_ffmpeg",
          sessionId: chunk.session_id,
          chunkId: chunk.id,
          path: chunk.raw_audio_path,
          severity: "error",
        });
        failed += 1;
        continue;
      }

      const repairedJob = await transcodeRawAndQueue(store, config, chunk, ffmpeg.path);
      store.recordRepairItem({
        type: repairedJob
          ? "stale_writing_chunk_repaired"
          : "stale_writing_chunk_transcode_failed",
        status: repairedJob ? "repaired" : "open",
        severity: repairedJob ? "info" : "error",
        sessionId: chunk.session_id,
        chunkId: chunk.id,
        path: chunk.raw_audio_path,
      });

      if (repairedJob) {
        repaired += 1;
      } else {
        store.updateSessionStatus(chunk.session_id, "needs_repair");
        failed += 1;
      }
      continue;
    }

    if (existsSync(partPath)) {
      store.markChunkFailed({
        chunkId: chunk.id,
        error: {
          message: "stale writing chunk에 final file은 없고 .part file만 남았습니다.",
          partPath,
        },
      });
      store.updateSessionStatus(chunk.session_id, "needs_repair");
      store.recordRepairItem({
        type: "stale_writing_chunk_part_only",
        sessionId: chunk.session_id,
        chunkId: chunk.id,
        path: partPath,
        severity: "error",
        details: { action: "파일을 직접 재생/보존할 수 있는지 수동 확인하세요." },
      });
      failed += 1;
      continue;
    }

    store.markChunkFailed({
      chunkId: chunk.id,
      error: {
        message: "stale writing chunk에 final file과 .part file이 모두 없습니다.",
      },
    });
    store.updateSessionStatus(chunk.session_id, "needs_repair");
    store.recordRepairItem({
      type: "stale_writing_chunk_audio_missing",
      sessionId: chunk.session_id,
      chunkId: chunk.id,
      path: chunk.raw_audio_path,
      severity: "error",
    });
    failed += 1;
  }

  return { repaired, failed };
}

async function repairChunksMissingSttJobs(
  store: SessionStore,
  config: Phase1Config,
): Promise<number> {
  const chunks = store.listChunksMissingSttJob();
  if (chunks.length === 0) {
    return 0;
  }

  const ffmpeg = await resolveFfmpegPath();
  let created = 0;

  for (const chunk of chunks) {
    if (chunk.stt_audio_path && existsSync(chunk.stt_audio_path)) {
      if (store.queueExistingSttJobForChunk(chunk.id, config.sttMaxAttempts)) {
        store.recordRepairItem({
          type: "missing_stt_job_created",
          status: "repaired",
          severity: "info",
          sessionId: chunk.session_id,
          chunkId: chunk.id,
          path: chunk.stt_audio_path,
        });
        created += 1;
      }
      continue;
    }

    if (!ffmpeg.path) {
      store.recordRepairItem({
        type: "missing_stt_job_no_ffmpeg",
        sessionId: chunk.session_id,
        chunkId: chunk.id,
        path: chunk.raw_audio_path,
        severity: "error",
        details: { message: "STT-safe audio를 만들 FFmpeg가 없습니다." },
      });
      continue;
    }

    const repaired = await transcodeRawAndQueue(store, config, chunk, ffmpeg.path);
    if (repaired) {
      created += 1;
    }
  }

  return created;
}

async function transcodeRawAndQueue(
  store: SessionStore,
  config: Phase1Config,
  chunk: ChunkRow,
  ffmpegPath: string,
): Promise<boolean> {
  if (!existsSync(chunk.raw_audio_path)) {
    store.recordRepairItem({
      type: "missing_stt_job_raw_audio_missing",
      sessionId: chunk.session_id,
      chunkId: chunk.id,
      path: chunk.raw_audio_path,
      severity: "error",
      details: { message: "finalized chunk이지만 raw audio file이 없습니다." },
    });
    return false;
  }

  const session = store.getSession(chunk.session_id);
  const sttAudioDir = path.join(session?.data_dir ?? path.dirname(chunk.raw_audio_path), "stt-audio");
  mkdirSync(sttAudioDir, { recursive: true });
  const baseName = path.basename(chunk.raw_audio_path, path.extname(chunk.raw_audio_path));
  const transcode = await transcodeToSttSafe(
    chunk.raw_audio_path,
    sttAudioDir,
    baseName,
    config.sttSafeFormat,
    ffmpegPath,
  );

  if (!transcode.playbackChecked || transcode.byteSize === 0) {
    store.markChunkTranscodeFailed({
      chunkId: chunk.id,
      error: transcode.error ?? "startup repair STT-safe transcode failed",
    });
    store.recordRepairItem({
      type: "missing_stt_job_transcode_failed",
      sessionId: chunk.session_id,
      chunkId: chunk.id,
      path: transcode.outputPath,
      severity: "error",
      details: {
        format: transcode.format,
        byteSize: transcode.byteSize,
        error: transcode.error,
      },
    });
    return false;
  }

  const sttSha256 = await sha256File(transcode.outputPath);
  store.completeChunkTranscodeAndQueueJob({
    chunkId: chunk.id,
    sttAudioPath: transcode.outputPath,
    sttAudioFormat: transcode.format,
    sttByteSize: transcode.byteSize,
    sttSha256,
    maxAttempts: config.sttMaxAttempts,
  });
  store.recordRepairItem({
    type: "missing_stt_job_created_after_transcode",
    status: "repaired",
    severity: "info",
    sessionId: chunk.session_id,
    chunkId: chunk.id,
    path: transcode.outputPath,
  });
  return true;
}

function scanOrphanAudioFiles(store: SessionStore, dataDir: string): number {
  if (!existsSync(dataDir)) {
    return 0;
  }

  let count = 0;
  for (const filePath of walkFiles(dataDir)) {
    const normalized = filePath.toLowerCase();
    const isAudio =
      normalized.endsWith(".ogg") ||
      normalized.endsWith(".webm") ||
      normalized.endsWith(".wav");
    if (!isAudio || normalized.endsWith(".part.ogg")) {
      continue;
    }

    if (store.hasChunkAudioPath(filePath)) {
      continue;
    }

    store.recordRepairItem({
      type: "orphan_audio_file",
      severity: "warn",
      sessionId: inferSessionId(dataDir, filePath),
      path: filePath,
      details: { message: "audio file은 있지만 SQLite chunk row가 없습니다." },
    });
    count += 1;
  }

  return count;
}

function* walkFiles(root: string): Generator<string> {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(fullPath);
      continue;
    }
    if (entry.isFile()) {
      yield fullPath;
    }
  }
}

function inferSessionId(dataDir: string, filePath: string): string | null {
  const relative = path.relative(dataDir, filePath);
  const [firstPart] = relative.split(path.sep);
  if (!firstPart || firstPart === ".." || firstPart.endsWith(".sqlite")) {
    return null;
  }
  return firstPart;
}

function partPathForRawPath(rawPath: string): string {
  if (rawPath.endsWith(".ogg")) {
    return rawPath.slice(0, -4) + ".part.ogg";
  }
  return `${rawPath}.part`;
}

function isOlderThan(iso: string, ageMs: number): boolean {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) {
    return true;
  }
  return Date.now() - at >= ageMs;
}

function estimateEndedAtMs(
  chunk: ChunkRow,
  sessionStartedAt: string | null,
  fileMtimeMs: number,
): number {
  if (!sessionStartedAt) {
    return chunk.started_at_ms;
  }
  const sessionStartMs = Date.parse(sessionStartedAt);
  if (!Number.isFinite(sessionStartMs)) {
    return chunk.started_at_ms;
  }
  return Math.max(chunk.started_at_ms, Math.trunc(fileMtimeMs - sessionStartMs));
}
