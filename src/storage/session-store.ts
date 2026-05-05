import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { redactForJson } from "../errors.js";
import { DirongDatabase, type SqlValue } from "./sqlite.js";

export type SessionStatus =
  | "created"
  | "active"
  | "reconnecting"
  | "stopping"
  | "finalized"
  | "failed"
  | "needs_repair";

export type ChunkStatus =
  | "writing"
  | "finalized"
  | "queued"
  | "transcode_failed"
  | "failed";

export type RepairScanSummary = {
  oldPartFiles: number;
  staleWritingChunksRepaired: number;
  staleWritingChunksFailed: number;
  missingSttJobsCreated: number;
  missingAudioJobsFailed: number;
  expiredLeasesReleased: number;
  orphanAudioFiles: number;
};

export type RecordingRuntimeState = {
  isRecording: boolean;
  sessionId: string | null;
  voiceChannelId: string | null;
  voiceChannelName: string | null;
  openChunks: number;
};

type SessionRow = {
  id: string;
  guild_id: string;
  guild_name: string | null;
  text_channel_id: string | null;
  voice_channel_id: string;
  voice_channel_name: string | null;
  started_by_user_id: string;
  started_by_display_name: string | null;
  stopped_by_user_id: string | null;
  stopped_by_display_name: string | null;
  status: SessionStatus;
  started_at: string;
  stopped_at: string | null;
  finalized_at: string | null;
  data_dir: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type ChunkRow = {
  id: string;
  session_id: string;
  chunk_index: number;
  user_id: string;
  display_name_snapshot: string;
  status: ChunkStatus;
  started_at_ms: number;
  ended_at_ms: number | null;
  duration_ms: number | null;
  raw_audio_path: string;
  raw_audio_format: string;
  raw_byte_size: number | null;
  raw_sha256: string | null;
  stt_audio_path: string | null;
  stt_audio_format: string | null;
  stt_byte_size: number | null;
  stt_sha256: string | null;
  transcode_status: string;
  transcode_error: string | null;
  close_reason: string | null;
  pipeline_error_json: string | null;
  created_at: string;
  updated_at: string;
};

export type SttJobRow = {
  id: string;
  session_id: string;
  chunk_id: string;
  user_id: string;
  display_name_snapshot: string;
  input_audio_path: string;
  status: string;
  attempts: number;
  max_attempts: number;
  locked_by: string | null;
  locked_until: string | null;
  next_attempt_at: string;
  input_audio_sha256: string | null;
  result_text_sha256: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type SpeechStatus = "speech" | "no_speech";

export type TranscriptSegmentRow = {
  id: string;
  session_id: string;
  chunk_id: string;
  stt_job_id: string;
  user_id: string;
  display_name_snapshot: string;
  start_ms: number;
  end_ms: number;
  text: string;
  speech_status: SpeechStatus;
  source: string;
  provider: string;
  model: string;
  input_audio_sha256: string | null;
  created_at: string;
  updated_at: string;
};

export class SessionStore {
  constructor(private readonly database: DirongDatabase) {}

  close(): void {
    this.database.close();
  }

  createSession(input: {
    id: string;
    guildId: string;
    guildName: string | null;
    textChannelId: string | null;
    voiceChannelId: string;
    voiceChannelName: string | null;
    startedByUserId: string;
    startedByDisplayName: string;
    dataDir: string;
  }): void {
    const now = isoNow();
    this.run(
      `INSERT INTO sessions (
        id, guild_id, guild_name, text_channel_id, voice_channel_id,
        voice_channel_name, started_by_user_id, started_by_display_name,
        status, started_at, data_dir, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'created', ?, ?, ?, ?)`,
      input.id,
      input.guildId,
      input.guildName,
      input.textChannelId,
      input.voiceChannelId,
      input.voiceChannelName,
      input.startedByUserId,
      input.startedByDisplayName,
      now,
      input.dataDir,
      now,
      now,
    );
  }

  updateSessionStatus(
    sessionId: string,
    status: SessionStatus,
    lastError?: string | null,
  ): void {
    this.run(
      `UPDATE sessions
       SET status = ?, last_error = COALESCE(?, last_error), updated_at = ?
       WHERE id = ?`,
      status,
      lastError ?? null,
      isoNow(),
      sessionId,
    );
  }

  stopSession(input: {
    sessionId: string;
    stoppedByUserId: string;
    stoppedByDisplayName: string;
    status: SessionStatus;
    lastError?: string | null;
  }): void {
    const now = isoNow();
    this.run(
      `UPDATE sessions
       SET status = ?, stopped_by_user_id = ?, stopped_by_display_name = ?,
           stopped_at = ?, finalized_at = ?, last_error = ?, updated_at = ?
       WHERE id = ?`,
      input.status,
      input.stoppedByUserId,
      input.stoppedByDisplayName,
      now,
      now,
      input.lastError ?? null,
      now,
      input.sessionId,
    );
  }

  getSession(sessionId: string): SessionRow | null {
    return this.get<SessionRow>("SELECT * FROM sessions WHERE id = ?", sessionId);
  }

  getLatestSession(): SessionRow | null {
    return this.get<SessionRow>(
      "SELECT * FROM sessions ORDER BY started_at DESC LIMIT 1",
    );
  }

  upsertSpeaker(input: {
    sessionId: string;
    userId: string;
    displayNameSnapshot: string;
    isBot: boolean;
    seenAtMs: number;
  }): void {
    const now = isoNow();
    this.run(
      `INSERT INTO session_speakers (
        session_id, user_id, display_name_snapshot, is_bot,
        first_seen_at_ms, first_seen_at, last_seen_at_ms, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, user_id) DO UPDATE SET
        display_name_snapshot = excluded.display_name_snapshot,
        is_bot = excluded.is_bot,
        last_seen_at_ms = excluded.last_seen_at_ms,
        last_seen_at = excluded.last_seen_at`,
      input.sessionId,
      input.userId,
      input.displayNameSnapshot,
      input.isBot ? 1 : 0,
      input.seenAtMs,
      now,
      input.seenAtMs,
      now,
    );
  }

  createChunkWriting(input: {
    chunkId: string;
    sessionId: string;
    chunkIndex: number;
    userId: string;
    displayNameSnapshot: string;
    startedAtMs: number;
    rawAudioPath: string;
  }): void {
    const now = isoNow();
    this.run(
      `INSERT INTO chunks (
        id, session_id, chunk_index, user_id, display_name_snapshot,
        status, started_at_ms, raw_audio_path, raw_audio_format,
        transcode_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'writing', ?, ?, 'ogg-opus', 'pending', ?, ?)`,
      input.chunkId,
      input.sessionId,
      input.chunkIndex,
      input.userId,
      input.displayNameSnapshot,
      input.startedAtMs,
      input.rawAudioPath,
      now,
      now,
    );
  }

  finalizeRawChunk(input: {
    chunkId: string;
    endedAtMs: number;
    durationMs: number;
    rawByteSize: number;
    rawSha256: string | null;
    closeReason: string;
    pipelineError: unknown;
  }): void {
    this.database.transaction(() => {
      this.run(
        `UPDATE chunks
         SET status = 'finalized', ended_at_ms = ?, duration_ms = ?,
             raw_byte_size = ?, raw_sha256 = ?, close_reason = ?,
             pipeline_error_json = ?, updated_at = ?
         WHERE id = ?`,
        input.endedAtMs,
        input.durationMs,
        input.rawByteSize,
        input.rawSha256,
        input.closeReason,
        input.pipelineError === null
          ? null
          : JSON.stringify(redactForJson(input.pipelineError)),
        isoNow(),
        input.chunkId,
      );
      this.run(
        `UPDATE session_speakers
         SET chunk_count = chunk_count + 1, last_seen_at_ms = ?, last_seen_at = ?
         WHERE session_id = (SELECT session_id FROM chunks WHERE id = ?)
           AND user_id = (SELECT user_id FROM chunks WHERE id = ?)`,
        input.endedAtMs,
        isoNow(),
        input.chunkId,
        input.chunkId,
      );
    });
  }

  completeChunkTranscodeAndQueueJob(input: {
    chunkId: string;
    sttAudioPath: string;
    sttAudioFormat: string;
    sttByteSize: number;
    sttSha256: string | null;
    maxAttempts: number;
  }): void {
    this.database.transaction(() => {
      const chunk = this.getChunk(input.chunkId);
      if (!chunk) {
        throw new Error(`chunk를 찾지 못했습니다: ${input.chunkId}`);
      }

      const now = isoNow();
      this.run(
        `UPDATE chunks
         SET status = 'queued', stt_audio_path = ?, stt_audio_format = ?,
             stt_byte_size = ?, stt_sha256 = ?, transcode_status = 'done',
             transcode_error = NULL, updated_at = ?
         WHERE id = ?`,
        input.sttAudioPath,
        input.sttAudioFormat,
        input.sttByteSize,
        input.sttSha256,
        now,
        input.chunkId,
      );

      this.insertSttJobForChunk(chunk, {
        inputAudioPath: input.sttAudioPath,
        inputAudioSha256: input.sttSha256,
        maxAttempts: input.maxAttempts,
        now,
      });
    });
  }

  markChunkTranscodeFailed(input: {
    chunkId: string;
    error: string;
  }): void {
    this.run(
      `UPDATE chunks
       SET status = 'transcode_failed', transcode_status = 'failed',
           transcode_error = ?, updated_at = ?
       WHERE id = ?`,
      input.error,
      isoNow(),
      input.chunkId,
    );
  }

  markChunkFailed(input: {
    chunkId: string;
    error: unknown;
  }): void {
    this.run(
      `UPDATE chunks
       SET status = 'failed', pipeline_error_json = ?, updated_at = ?
       WHERE id = ?`,
      JSON.stringify(redactForJson(input.error)),
      isoNow(),
      input.chunkId,
    );
  }

  getChunk(chunkId: string): ChunkRow | null {
    return this.get<ChunkRow>("SELECT * FROM chunks WHERE id = ?", chunkId);
  }

  listChunksMissingSttJob(): ChunkRow[] {
    return this.all<ChunkRow>(
      `SELECT c.*
       FROM chunks c
       LEFT JOIN stt_jobs j ON j.chunk_id = c.id
       WHERE j.id IS NULL
         AND c.status IN ('finalized', 'queued', 'transcode_failed')
       ORDER BY c.created_at ASC`,
    );
  }

  listWritingChunks(): ChunkRow[] {
    return this.all<ChunkRow>(
      `SELECT *
       FROM chunks
       WHERE status = 'writing'
       ORDER BY created_at ASC`,
    );
  }

  queueExistingSttJobForChunk(chunkId: string, maxAttempts: number): boolean {
    const chunk = this.getChunk(chunkId);
    if (!chunk?.stt_audio_path) {
      return false;
    }

    this.database.transaction(() => {
      const now = isoNow();
      this.run(
        `UPDATE chunks
         SET status = 'queued', transcode_status = 'done', updated_at = ?
         WHERE id = ?`,
        now,
        chunkId,
      );
      this.insertSttJobForChunk(chunk, {
        inputAudioPath: chunk.stt_audio_path ?? "",
        inputAudioSha256: chunk.stt_sha256 ?? chunk.raw_sha256,
        maxAttempts,
        now,
      });
    });

    return true;
  }

  recordConnectionEvent(input: {
    sessionId: string | null;
    eventType: string;
    level?: "debug" | "info" | "warn" | "error";
    startedAtMs?: number | null;
    endedAtMs?: number | null;
    details?: unknown;
  }): void {
    this.run(
      `INSERT INTO connection_events (
        session_id, event_type, level, started_at_ms, ended_at_ms,
        details_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      input.sessionId,
      input.eventType,
      input.level ?? "info",
      input.startedAtMs ?? null,
      input.endedAtMs ?? null,
      input.details === undefined
        ? null
        : JSON.stringify(redactForJson(input.details)),
      isoNow(),
    );
  }

  recordRepairItem(input: {
    type: string;
    status?: "open" | "repaired" | "failed" | "ignored";
    severity?: "info" | "warn" | "error";
    sessionId?: string | null;
    path?: string | null;
    chunkId?: string | null;
    sttJobId?: string | null;
    details?: unknown;
  }): void {
    const now = isoNow();
    const dedupeKey = [
      input.type,
      input.sessionId ?? "",
      input.path ?? "",
      input.chunkId ?? "",
      input.sttJobId ?? "",
    ].join(":");

    this.run(
      `INSERT INTO repair_items (
        dedupe_key, session_id, item_type, status, severity, path,
        chunk_id, stt_job_id, details_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(dedupe_key) DO UPDATE SET
        status = excluded.status,
        severity = excluded.severity,
        details_json = excluded.details_json,
        updated_at = excluded.updated_at,
        resolved_at = CASE
          WHEN excluded.status IN ('repaired', 'ignored') THEN excluded.updated_at
          ELSE repair_items.resolved_at
        END`,
      dedupeKey,
      input.sessionId ?? null,
      input.type,
      input.status ?? "open",
      input.severity ?? "warn",
      input.path ?? null,
      input.chunkId ?? null,
      input.sttJobId ?? null,
      input.details === undefined
        ? null
        : JSON.stringify(redactForJson(input.details)),
      now,
      now,
    );
  }

  failJobsWithMissingAudio(): number {
    const jobs = this.all<SttJobRow>(
      `SELECT *
       FROM stt_jobs
       WHERE status NOT IN ('done', 'failed_missing_file')
         AND input_audio_path IS NOT NULL`,
    );

    let failed = 0;
    for (const job of jobs) {
      if (existsSync(job.input_audio_path)) {
        continue;
      }

      const now = isoNow();
      this.run(
        `UPDATE stt_jobs
         SET status = 'failed_missing_file', locked_by = NULL,
             locked_until = NULL, last_error = ?, updated_at = ?
         WHERE id = ?`,
        "STT input audio file이 없습니다.",
        now,
        job.id,
      );
      this.recordRepairItem({
        type: "stt_job_missing_audio",
        sessionId: job.session_id,
        chunkId: job.chunk_id,
        sttJobId: job.id,
        path: job.input_audio_path,
        severity: "error",
        details: { previousStatus: job.status },
      });
      failed += 1;
    }

    return failed;
  }

  releaseExpiredProcessingLeases(nowIso = isoNow()): number {
    const jobs = this.all<SttJobRow>(
      `SELECT *
       FROM stt_jobs
       WHERE status = 'processing'
         AND locked_until IS NOT NULL
         AND locked_until < ?
         AND attempts < max_attempts`,
      nowIso,
    );

    for (const job of jobs) {
      this.run(
        `UPDATE stt_jobs
         SET status = 'queued', locked_by = NULL, locked_until = NULL,
             next_attempt_at = ?, updated_at = ?
         WHERE id = ?`,
        nowIso,
        nowIso,
        job.id,
      );
      this.recordRepairItem({
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

  claimNextSttJob(input: {
    workerId: string;
    leaseMs: number;
    sessionId?: string | null;
  }): SttJobRow | null {
    const now = isoNow();
    const lockedUntil = new Date(Date.now() + input.leaseMs).toISOString();
    let claimed: SttJobRow | null = null;

    this.database.transaction(() => {
      const job = input.sessionId
        ? this.get<SttJobRow>(
            `SELECT *
             FROM stt_jobs
             WHERE status = 'queued'
               AND next_attempt_at <= ?
               AND session_id = ?
             ORDER BY created_at ASC
             LIMIT 1`,
            now,
            input.sessionId,
          )
        : this.get<SttJobRow>(
            `SELECT *
             FROM stt_jobs
             WHERE status = 'queued'
               AND next_attempt_at <= ?
             ORDER BY created_at ASC
             LIMIT 1`,
            now,
          );

      if (!job) {
        return;
      }

      const result = this.database.db.prepare(
        `UPDATE stt_jobs
         SET status = 'processing',
             attempts = attempts + 1,
             locked_by = ?,
             locked_until = ?,
             last_error = NULL,
             updated_at = ?
         WHERE id = ?
           AND status = 'queued'`,
      ).run(input.workerId, lockedUntil, now, job.id) as { changes: number };

      if (result.changes === 0) {
        return;
      }

      claimed = this.get<SttJobRow>("SELECT * FROM stt_jobs WHERE id = ?", job.id);
    });

    return claimed;
  }

  listQueuedSttJobs(input: {
    limit: number;
    sessionId?: string | null;
  }): SttJobRow[] {
    const now = isoNow();
    return input.sessionId
      ? this.all<SttJobRow>(
          `SELECT *
           FROM stt_jobs
           WHERE status = 'queued'
             AND next_attempt_at <= ?
             AND session_id = ?
           ORDER BY created_at ASC
           LIMIT ?`,
          now,
          input.sessionId,
          input.limit,
        )
      : this.all<SttJobRow>(
          `SELECT *
           FROM stt_jobs
           WHERE status = 'queued'
             AND next_attempt_at <= ?
           ORDER BY created_at ASC
           LIMIT ?`,
          now,
          input.limit,
        );
  }

  completeFakeSttJob(input: {
    job: SttJobRow;
    text: string;
  }): TranscriptSegmentRow {
    return this.completeSttJob({
      job: input.job,
      text: input.text,
      source: "fake",
      provider: "dirong-fake-stt",
      model: "fake-v1",
      inputAudioSha256: input.job.input_audio_sha256,
    });
  }

  completeSttJob(input: {
    job: SttJobRow;
    text: string;
    source: string;
    provider: string;
    model: string;
    inputAudioSha256?: string | null;
  }): TranscriptSegmentRow {
    const chunk = this.getChunk(input.job.chunk_id);
    if (!chunk) {
      throw new Error(`STT job의 chunk를 찾지 못했습니다: ${input.job.chunk_id}`);
    }

    const now = isoNow();
    const segmentId = `seg_${input.job.chunk_id}`;
    const resultHash = sha256Text(input.text);
    const speechStatus: SpeechStatus =
      input.text.trim().length === 0 ? "no_speech" : "speech";
    const startMs = chunk.started_at_ms;
    const endMs = chunk.ended_at_ms ?? chunk.started_at_ms;

    this.database.transaction(() => {
      this.run(
        `INSERT INTO transcript_segments (
          id, session_id, chunk_id, stt_job_id, user_id,
          display_name_snapshot, start_ms, end_ms, text, speech_status,
          source, provider, model, input_audio_sha256,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(stt_job_id) DO UPDATE SET
          text = excluded.text,
          speech_status = excluded.speech_status,
          source = excluded.source,
          provider = excluded.provider,
          model = excluded.model,
          input_audio_sha256 = excluded.input_audio_sha256,
          updated_at = excluded.updated_at`,
        segmentId,
        input.job.session_id,
        input.job.chunk_id,
        input.job.id,
        input.job.user_id,
        input.job.display_name_snapshot,
        startMs,
        endMs,
        input.text,
        speechStatus,
        input.source,
        input.provider,
        input.model,
        input.inputAudioSha256 ?? input.job.input_audio_sha256,
        now,
        now,
      );

      this.run(
        `UPDATE stt_jobs
         SET status = 'done',
             locked_by = NULL,
             locked_until = NULL,
             input_audio_sha256 = COALESCE(?, input_audio_sha256),
             result_text_sha256 = ?,
             last_error = NULL,
             updated_at = ?
         WHERE id = ?`,
        input.inputAudioSha256 ?? null,
        resultHash,
        now,
        input.job.id,
      );
    });

    const segment = this.get<TranscriptSegmentRow>(
      "SELECT * FROM transcript_segments WHERE stt_job_id = ?",
      input.job.id,
    );
    if (!segment) {
      throw new Error(`transcript segment 저장에 실패했습니다: ${input.job.id}`);
    }
    return segment;
  }

  markSttJobMissingAudio(job: SttJobRow): void {
    const now = isoNow();
    this.database.transaction(() => {
      this.run(
        `UPDATE stt_jobs
         SET status = 'failed_missing_file',
             locked_by = NULL,
             locked_until = NULL,
             last_error = ?,
             updated_at = ?
         WHERE id = ?`,
        "STT input audio file이 없습니다.",
        now,
        job.id,
      );
      this.recordRepairItem({
        type: "stt_job_missing_audio",
        sessionId: job.session_id,
        chunkId: job.chunk_id,
        sttJobId: job.id,
        path: job.input_audio_path,
        severity: "error",
        details: { previousStatus: job.status },
      });
    });
  }

  failProcessingSttJob(input: {
    jobId: string;
    error: string;
  }): void {
    const job = this.get<SttJobRow>("SELECT * FROM stt_jobs WHERE id = ?", input.jobId);
    if (!job) {
      return;
    }

    const now = isoNow();
    const shouldRetry = job.attempts < job.max_attempts;
    const backoffMs = Math.min(
      15 * 60 * 1000,
      30 * 1000 * Math.max(1, 2 ** Math.max(0, job.attempts - 1)),
    );
    const nextAttemptAt = new Date(Date.now() + backoffMs).toISOString();

    this.run(
      `UPDATE stt_jobs
       SET status = ?,
           locked_by = NULL,
           locked_until = NULL,
           next_attempt_at = ?,
           last_error = ?,
           updated_at = ?
       WHERE id = ?`,
      shouldRetry ? "queued" : "failed",
      shouldRetry ? nextAttemptAt : now,
      input.error,
      now,
      input.jobId,
    );
  }

  listRecentTranscriptSegments(sessionId: string | null, limit = 30): TranscriptSegmentRow[] {
    return sessionId === null
      ? this.all<TranscriptSegmentRow>(
          `SELECT *
           FROM transcript_segments
           ORDER BY created_at DESC
           LIMIT ?`,
          limit,
        )
      : this.all<TranscriptSegmentRow>(
          `SELECT *
           FROM transcript_segments
           WHERE session_id = ?
           ORDER BY start_ms DESC
           LIMIT ?`,
          sessionId,
          limit,
        );
  }

  listTranscriptTimelineSegments(input: {
    sessionId: string;
    includeNoSpeech?: boolean;
  }): TranscriptSegmentRow[] {
    if (input.includeNoSpeech) {
      return this.all<TranscriptSegmentRow>(
        `SELECT *
         FROM transcript_segments
         WHERE session_id = ?
         ORDER BY start_ms ASC, end_ms ASC, created_at ASC`,
        input.sessionId,
      );
    }

    return this.all<TranscriptSegmentRow>(
      `SELECT *
       FROM transcript_segments
       WHERE session_id = ?
         AND speech_status = 'speech'
         AND length(trim(text)) > 0
       ORDER BY start_ms ASC, end_ms ASC, created_at ASC`,
      input.sessionId,
    );
  }

  listRecentTranscriptTextForSpeaker(input: {
    sessionId: string;
    userId: string;
    beforeStartMs: number;
    limit: number;
    sources?: string[];
  }): string[] {
    const sources = input.sources?.filter((source) => source.trim().length > 0) ?? [];
    if (sources.length === 0) {
      return this.all<{ text: string }>(
        `SELECT text
         FROM transcript_segments
         WHERE session_id = ?
           AND user_id = ?
           AND start_ms < ?
           AND speech_status = 'speech'
           AND length(trim(text)) > 0
         ORDER BY start_ms DESC
         LIMIT ?`,
        input.sessionId,
        input.userId,
        input.beforeStartMs,
        input.limit,
      ).map((row) => row.text).reverse();
    }

    const placeholders = sources.map(() => "?").join(", ");
    return this.all<{ text: string }>(
      `SELECT text
       FROM transcript_segments
       WHERE session_id = ?
         AND user_id = ?
         AND start_ms < ?
         AND speech_status = 'speech'
         AND length(trim(text)) > 0
         AND source IN (${placeholders})
       ORDER BY start_ms DESC
       LIMIT ?`,
      input.sessionId,
      input.userId,
      input.beforeStartMs,
      ...sources,
      input.limit,
    ).map((row) => row.text).reverse();
  }

  hasChunkAudioPath(filePath: string): boolean {
    const resolved = path.resolve(filePath);
    const row = this.get<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM chunks
       WHERE raw_audio_path = ? OR stt_audio_path = ?`,
      resolved,
      resolved,
    );
    return (row?.count ?? 0) > 0;
  }

  getAudioPathForChunk(
    chunkId: string,
    kind: "raw" | "stt",
  ): { path: string; format: string } | null {
    const chunk = this.getChunk(chunkId);
    if (!chunk) {
      return null;
    }

    if (kind === "raw") {
      return { path: chunk.raw_audio_path, format: chunk.raw_audio_format };
    }

    if (!chunk.stt_audio_path || !chunk.stt_audio_format) {
      return null;
    }
    return { path: chunk.stt_audio_path, format: chunk.stt_audio_format };
  }

  getDashboardState(runtime: RecordingRuntimeState): unknown {
    const currentSession =
      runtime.sessionId !== null
        ? this.getSession(runtime.sessionId)
        : this.getLatestSession();
    const sessionId = currentSession?.id ?? null;
    const speakers =
      sessionId === null
        ? []
        : this.all(
            `SELECT *
             FROM session_speakers
             WHERE session_id = ?
             ORDER BY first_seen_at_ms ASC`,
            sessionId,
          );
    const recentChunks =
      sessionId === null
        ? []
        : this.all(
            `SELECT
               c.*,
               j.id AS stt_job_id,
               j.status AS stt_job_status,
               j.attempts AS stt_job_attempts,
               j.max_attempts AS stt_job_max_attempts,
               j.last_error AS stt_job_last_error
             FROM chunks c
             LEFT JOIN stt_jobs j ON j.chunk_id = c.id
             WHERE c.session_id = ?
             ORDER BY c.created_at DESC
             LIMIT 50`,
            sessionId,
          );
    const recentConnectionEvents = this.all(
      `SELECT *
       FROM connection_events
       WHERE (? IS NULL OR session_id = ?)
       ORDER BY created_at DESC
       LIMIT 30`,
      sessionId,
      sessionId,
    );
    const recentSttJobs =
      sessionId === null
        ? this.all(
            `SELECT j.*, c.duration_ms, c.stt_byte_size
             FROM stt_jobs j
             LEFT JOIN chunks c ON c.id = j.chunk_id
             ORDER BY j.created_at DESC
             LIMIT 30`,
          )
        : this.all(
            `SELECT j.*, c.duration_ms, c.stt_byte_size
             FROM stt_jobs j
             LEFT JOIN chunks c ON c.id = j.chunk_id
             WHERE j.session_id = ?
             ORDER BY j.created_at DESC
             LIMIT 30`,
            sessionId,
          );
    const recentRepairItems = this.all(
      `SELECT *
       FROM repair_items
       WHERE status <> 'ignored'
       ORDER BY updated_at DESC
       LIMIT 30`,
    );
    const queueStats = this.all(
      `SELECT status, COUNT(*) AS count
       FROM stt_jobs
       GROUP BY status
       ORDER BY status ASC`,
    );
    const recentTranscriptSegments = this.listRecentTranscriptSegments(sessionId, 30);

    return redactForJson({
      generatedAt: isoNow(),
      runtime,
      currentSession,
      speakers,
      recentChunks,
      recentSttJobs,
      recentConnectionEvents,
      recentRepairItems,
      recentTranscriptSegments,
      queueStats,
      dbPath: this.database.dbPath,
    });
  }

  statusText(runtime: RecordingRuntimeState, dashboardUrl: string): string {
    const session =
      runtime.sessionId !== null
        ? this.getSession(runtime.sessionId)
        : this.getLatestSession();
    if (!session) {
      return [
        "진행 중이거나 최근 생성된 녹음 세션이 없습니다.",
        `Dashboard: ${dashboardUrl}`,
      ].join("\n");
    }

    const speakerCount = this.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM session_speakers WHERE session_id = ? AND is_bot = 0",
      session.id,
    )?.count ?? 0;
    const chunkCount = this.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM chunks WHERE session_id = ?",
      session.id,
    )?.count ?? 0;
    const queueStats = this.all<{ status: string; count: number }>(
      `SELECT status, COUNT(*) AS count
       FROM stt_jobs
       WHERE session_id = ?
       GROUP BY status
       ORDER BY status ASC`,
      session.id,
    );
    const openRepairs = this.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM repair_items WHERE status = 'open'",
    )?.count ?? 0;

    return [
      `Recording + STT 상태: ${session.status}`,
      `세션: ${session.id}`,
      `음성 채널: ${session.voice_channel_name ?? session.voice_channel_id}`,
      `현재 녹음: ${runtime.isRecording ? "yes" : "no"}`,
      `열려 있는 chunk: ${runtime.openChunks}`,
      `speaker: ${speakerCount}명`,
      `chunk: ${chunkCount}개`,
      `STT queue: ${formatQueueStats(queueStats)}`,
      `open repair item: ${openRepairs}개`,
      `Dashboard: ${dashboardUrl}`,
    ].join("\n");
  }

  private insertSttJobForChunk(
    chunk: ChunkRow,
    input: {
      inputAudioPath: string;
      inputAudioSha256: string | null;
      maxAttempts: number;
      now: string;
    },
  ): void {
    const jobId = `stt_${chunk.id}`;
    this.run(
      `INSERT INTO stt_jobs (
        id, session_id, chunk_id, user_id, display_name_snapshot,
        input_audio_path, status, attempts, max_attempts, locked_by,
        locked_until, next_attempt_at, input_audio_sha256,
        result_text_sha256, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, ?, NULL, NULL, ?, ?, NULL, NULL, ?, ?)
      ON CONFLICT(chunk_id) DO UPDATE SET
        input_audio_path = excluded.input_audio_path,
        status = CASE
          WHEN stt_jobs.status = 'failed_missing_file' THEN 'queued'
          ELSE stt_jobs.status
        END,
        input_audio_sha256 = excluded.input_audio_sha256,
        max_attempts = excluded.max_attempts,
        updated_at = excluded.updated_at`,
      jobId,
      chunk.session_id,
      chunk.id,
      chunk.user_id,
      chunk.display_name_snapshot,
      input.inputAudioPath,
      input.maxAttempts,
      input.now,
      input.inputAudioSha256,
      input.now,
      input.now,
    );
  }

  private run(sql: string, ...params: SqlValue[]): void {
    this.database.db.prepare(sql).run(...params);
  }

  private get<T>(sql: string, ...params: SqlValue[]): T | null {
    const row = this.database.db.prepare(sql).get(...params);
    return row === undefined ? null : (row as T);
  }

  private all<T = Record<string, unknown>>(sql: string, ...params: SqlValue[]): T[] {
    return this.database.db.prepare(sql).all(...params) as T[];
  }
}

function isoNow(): string {
  return new Date().toISOString();
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function formatQueueStats(rows: Array<{ status: string; count: number }>): string {
  const counts = new Map(rows.map((row) => [row.status, row.count]));
  return ["queued", "processing", "done", "failed", "failed_missing_file"]
    .map((status) => `${status}:${counts.get(status) ?? 0}`)
    .join(" / ");
}

export function relativeDisplayPath(filePath: string | null): string | null {
  if (!filePath) {
    return null;
  }
  return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
}
