import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { redactForJson } from "../errors.js";
import { buildAiCleanupSttTerminalSnapshot } from "./ai-cleanup-terminal-read-model.js";
import { buildDashboardReadModel } from "./dashboard-read-model.js";
import {
  createStoragePathResolver,
  type StoragePathResolver,
} from "./path-resolver.js";
import { SqlRunner } from "./sql-runner.js";
import { DirongDatabase, type SqlValue } from "./sqlite.js";
import { buildStatusTextReadModel } from "./status-text-read-model.js";

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
  guildId?: string | null;
  voiceChannelId: string | null;
  voiceChannelName: string | null;
  openChunks: number;
};

export type SessionRow = {
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

export type AiCleanupJobStatus =
  | "queued"
  | "processing"
  | "done"
  | "failed"
  | "blocked";

export type AiCleanupFailureKind =
  | "provider_not_found"
  | "provider_auth_required"
  | "provider_timeout"
  | "provider_nonzero_exit"
  | "missing_timeline"
  | "empty_timeline"
  | "input_too_long"
  | "unsafe_input"
  | "empty_output"
  | "malformed_json"
  | "schema_invalid"
  | "file_io"
  | "unknown";

export type AiCleanupJobRow = {
  id: string;
  session_id: string;
  status: AiCleanupJobStatus;
  attempts: number;
  max_attempts: number;
  locked_by: string | null;
  locked_until: string | null;
  next_attempt_at: string;
  provider: string;
  model: string;
  command: string | null;
  prompt_version: string;
  input_contract_version: string;
  input_hash: string;
  input_entry_count: number;
  input_timeline_json_path: string | null;
  input_timeline_markdown_path: string | null;
  prompt_path: string | null;
  raw_output_path: string | null;
  stderr_path: string | null;
  parsed_json_path: string | null;
  markdown_path: string | null;
  output_hash: string | null;
  failure_kind: AiCleanupFailureKind | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type MeetingNotesDraftRow = {
  id: string;
  session_id: string;
  ai_cleanup_job_id: string;
  schema_version: string;
  language: string;
  title: string;
  summary_text: string;
  draft_json: string;
  markdown: string;
  json_path: string;
  markdown_path: string;
  raw_output_path: string;
  provider: string;
  model: string;
  prompt_version: string;
  input_hash: string;
  output_hash: string;
  validation_status: string;
  created_at: string;
  updated_at: string;
};

export type AiCleanupSttTerminalSnapshot = {
  sessionId: string;
  sessionStatus: "finalized";
  openChunkCount: number;
  sttQueuedCount: number;
  sttProcessingCount: number;
  sttDoneCount: number;
  sttFailedCount: number;
  sttFailedMissingFileCount: number;
  sttOtherNonTerminalCount: number;
  chunksMissingSttJobCount: number;
  chunksWithTranscodeFailedCount: number;
  chunksMissingSttAudioCount: number;
  realTranscriptEntryCount: number;
  isTerminal: boolean;
  canGenerateDraft: boolean;
  shouldRecordEmptyTimelineBlock: boolean;
  canInvokeRunner: boolean;
  warnings: string[];
};

export type AiCleanupLeaseRepairSummary = {
  requeued: number;
  failed: number;
};

export type SessionStoreOptions = {
  storageRoot?: string | null;
  normalizeStoredPaths?: boolean;
};

export class SessionStore {
  private readonly paths: StoragePathResolver;
  private readonly sql: SqlRunner;

  constructor(
    private readonly database: DirongDatabase,
    options: SessionStoreOptions = {},
  ) {
    this.paths = createStoragePathResolver(options.storageRoot);
    this.sql = new SqlRunner(database);
    if (options.normalizeStoredPaths && this.paths.storageRoot) {
      this.normalizeStoredPaths();
    }
  }

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
      this.toStoredPath(input.dataDir),
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
    return this.mapSessionRow(
      this.get<SessionRow>("SELECT * FROM sessions WHERE id = ?", sessionId),
    );
  }

  getLatestSession(): SessionRow | null {
    return this.mapSessionRow(
      this.get<SessionRow>(
        "SELECT * FROM sessions ORDER BY started_at DESC LIMIT 1",
      ),
    );
  }

  listFinalizedSessionsForAiCleanupAutomation(
    input:
      | number
      | {
          limit?: number;
          provider?: string;
          model?: string;
          promptVersion?: string;
          nowIso?: string;
        } = 3,
  ): SessionRow[] {
    const options = typeof input === "number" ? { limit: input } : input;
    const safeLimit = Math.max(1, Math.trunc(options.limit ?? 3));
    const nowIso = options.nowIso ?? isoNow();
    const provider = options.provider ?? null;
    const model = options.model ?? null;
    const promptVersion = options.promptVersion ?? null;
    return this.all<SessionRow>(
      `WITH finalized_sessions AS (
         SELECT *
         FROM sessions
         WHERE status = 'finalized'
       ),
       chunk_stats AS (
         SELECT
           session_id,
           SUM(CASE WHEN status = 'writing' THEN 1 ELSE 0 END) AS open_chunk_count
         FROM chunks
         GROUP BY session_id
       ),
       stt_stats AS (
         SELECT
           session_id,
           SUM(CASE WHEN status IN ('queued', 'processing') THEN 1 ELSE 0 END) AS waiting_stt_count,
           SUM(
             CASE
               WHEN status NOT IN ('done', 'failed', 'failed_missing_file', 'queued', 'processing') THEN 1
               ELSE 0
             END
           ) AS other_non_terminal_stt_count
         FROM stt_jobs
         GROUP BY session_id
       ),
       transcript_stats AS (
         SELECT session_id, COUNT(*) AS real_transcript_count
         FROM transcript_segments
         WHERE speech_status = 'speech'
           AND length(trim(text)) > 0
           AND source <> 'fake'
           AND provider <> 'dirong-fake-stt'
         GROUP BY session_id
       ),
       matching_ai_jobs AS (
         SELECT
           session_id,
           COUNT(*) AS matching_ai_job_count,
           SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing_ai_job_count,
           SUM(CASE WHEN status = 'queued' AND next_attempt_at <= ? THEN 1 ELSE 0 END) AS due_queued_ai_job_count,
           SUM(CASE WHEN status = 'queued' AND next_attempt_at > ? THEN 1 ELSE 0 END) AS future_queued_ai_job_count
         FROM ai_cleanup_jobs
         WHERE (? IS NULL OR provider = ?)
           AND (? IS NULL OR model = ?)
           AND (? IS NULL OR prompt_version = ?)
         GROUP BY session_id
       )
       SELECT s.*
       FROM finalized_sessions s
       LEFT JOIN chunk_stats c ON c.session_id = s.id
       LEFT JOIN stt_stats stt ON stt.session_id = s.id
       LEFT JOIN transcript_stats t ON t.session_id = s.id
       LEFT JOIN matching_ai_jobs ai ON ai.session_id = s.id
       ORDER BY
         CASE
           WHEN COALESCE(ai.processing_ai_job_count, 0) > 0 THEN 0
           WHEN COALESCE(c.open_chunk_count, 0) = 0
             AND COALESCE(stt.waiting_stt_count, 0) = 0
             AND COALESCE(stt.other_non_terminal_stt_count, 0) = 0
             AND COALESCE(t.real_transcript_count, 0) > 0
             AND (
               COALESCE(ai.matching_ai_job_count, 0) = 0
               OR COALESCE(ai.due_queued_ai_job_count, 0) > 0
             ) THEN 1
           WHEN COALESCE(c.open_chunk_count, 0) = 0
             AND COALESCE(stt.waiting_stt_count, 0) = 0
             AND COALESCE(stt.other_non_terminal_stt_count, 0) = 0
             AND COALESCE(t.real_transcript_count, 0) = 0
             AND (
               COALESCE(ai.matching_ai_job_count, 0) = 0
               OR COALESCE(ai.due_queued_ai_job_count, 0) > 0
             ) THEN 2
           WHEN COALESCE(c.open_chunk_count, 0) > 0
             OR COALESCE(stt.waiting_stt_count, 0) > 0
             OR COALESCE(stt.other_non_terminal_stt_count, 0) > 0 THEN 3
           WHEN COALESCE(ai.future_queued_ai_job_count, 0) > 0 THEN 4
           ELSE 5
         END ASC,
         COALESCE(s.finalized_at, s.updated_at, s.created_at) ASC
       LIMIT ?`,
      nowIso,
      nowIso,
      provider,
      provider,
      model,
      model,
      promptVersion,
      promptVersion,
      safeLimit,
    ).map((row) => this.mapSessionRow(row));
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
      this.toStoredPath(input.rawAudioPath),
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
        this.toStoredPath(input.sttAudioPath),
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
    return this.mapChunkRow(
      this.get<ChunkRow>("SELECT * FROM chunks WHERE id = ?", chunkId),
    );
  }

  listChunksMissingSttJob(): ChunkRow[] {
    return this.all<ChunkRow>(
      `SELECT c.*
       FROM chunks c
       LEFT JOIN stt_jobs j ON j.chunk_id = c.id
       WHERE j.id IS NULL
         AND c.status IN ('finalized', 'queued', 'transcode_failed')
       ORDER BY c.created_at ASC`,
    ).map((row) => this.mapChunkRow(row));
  }

  listWritingChunks(): ChunkRow[] {
    return this.all<ChunkRow>(
      `SELECT *
       FROM chunks
       WHERE status = 'writing'
       ORDER BY created_at ASC`,
    ).map((row) => this.mapChunkRow(row));
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
    const storedPath = this.toStoredPath(input.path ?? null);
    const dedupeKey = makeRepairItemDedupeKey({
      type: input.type,
      sessionId: input.sessionId ?? null,
      path: storedPath,
      chunkId: input.chunkId ?? null,
      sttJobId: input.sttJobId ?? null,
    });

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
      storedPath,
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
      const inputAudioPath = this.resolveStoredPath(job.input_audio_path);
      if (inputAudioPath && existsSync(inputAudioPath)) {
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
        path: inputAudioPath,
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

      claimed = this.mapSttJobRow(
        this.get<SttJobRow>("SELECT * FROM stt_jobs WHERE id = ?", job.id),
      );
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
        ).map((row) => this.mapSttJobRow(row))
      : this.all<SttJobRow>(
          `SELECT *
           FROM stt_jobs
           WHERE status = 'queued'
             AND next_attempt_at <= ?
           ORDER BY created_at ASC
           LIMIT ?`,
          now,
          input.limit,
        ).map((row) => this.mapSttJobRow(row));
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
        path: this.resolveStoredPath(job.input_audio_path),
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
    includeFakeStt?: boolean;
  }): TranscriptSegmentRow[] {
    const conditions = ["session_id = ?"];
    const params: SqlValue[] = [input.sessionId];

    if (!input.includeNoSpeech) {
      conditions.push("speech_status = 'speech'");
      conditions.push("length(trim(text)) > 0");
    }

    if (!input.includeFakeStt) {
      conditions.push("source <> 'fake'");
      conditions.push("provider <> 'dirong-fake-stt'");
    }

    return this.all<TranscriptSegmentRow>(
      `SELECT *
       FROM transcript_segments
       WHERE ${conditions.join(" AND ")}
       ORDER BY start_ms ASC, end_ms ASC, created_at ASC`,
      ...params,
    );
  }

  getAiCleanupSttTerminalSnapshot(
    sessionId: string,
  ): AiCleanupSttTerminalSnapshot | null {
    return buildAiCleanupSttTerminalSnapshot({
      sql: this.sql,
      sessionId,
      session: this.getSession(sessionId),
      listTranscriptTimelineSegments: (input) =>
        this.listTranscriptTimelineSegments(input),
    });
  }

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
    const now = isoNow();
    this.run(
      `INSERT INTO ai_cleanup_jobs (
        id, session_id, status, attempts, max_attempts, locked_by,
        locked_until, next_attempt_at, provider, model, command,
        prompt_version, input_contract_version, input_hash,
        input_entry_count, input_timeline_json_path,
        input_timeline_markdown_path, created_at, updated_at
      ) VALUES (?, ?, 'queued', 0, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, provider, model, prompt_version, input_hash)
      DO UPDATE SET
        command = excluded.command,
        input_entry_count = excluded.input_entry_count,
        input_timeline_json_path = COALESCE(excluded.input_timeline_json_path, ai_cleanup_jobs.input_timeline_json_path),
        input_timeline_markdown_path = COALESCE(excluded.input_timeline_markdown_path, ai_cleanup_jobs.input_timeline_markdown_path),
        max_attempts = CASE
          WHEN ai_cleanup_jobs.status IN ('queued', 'blocked', 'failed') THEN excluded.max_attempts
          ELSE ai_cleanup_jobs.max_attempts
        END,
        updated_at = excluded.updated_at`,
      input.id,
      input.sessionId,
      input.maxAttempts,
      now,
      input.provider,
      input.model,
      input.command,
      input.promptVersion,
      input.inputContractVersion,
      input.inputHash,
      input.inputEntryCount,
      this.toStoredPath(input.inputTimelineJsonPath),
      this.toStoredPath(input.inputTimelineMarkdownPath),
      now,
      now,
    );

    const job = this.mapAiCleanupJobRow(
      this.get<AiCleanupJobRow>(
        `SELECT *
         FROM ai_cleanup_jobs
         WHERE session_id = ?
           AND provider = ?
           AND model = ?
           AND prompt_version = ?
           AND input_hash = ?`,
        input.sessionId,
        input.provider,
        input.model,
        input.promptVersion,
        input.inputHash,
      ),
    );
    if (!job) {
      throw new Error("AI cleanup job 저장에 실패했습니다.");
    }
    return job;
  }

  getAiCleanupJob(jobId: string): AiCleanupJobRow | null {
    return this.mapAiCleanupJobRow(
      this.get<AiCleanupJobRow>(
        "SELECT * FROM ai_cleanup_jobs WHERE id = ?",
        jobId,
      ),
    );
  }

  getAiCleanupJobByIdentity(input: {
    sessionId: string;
    provider: string;
    model: string;
    promptVersion: string;
    inputHash: string;
  }): AiCleanupJobRow | null {
    return this.mapAiCleanupJobRow(
      this.get<AiCleanupJobRow>(
        `SELECT *
         FROM ai_cleanup_jobs
         WHERE session_id = ?
           AND provider = ?
           AND model = ?
           AND prompt_version = ?
           AND input_hash = ?`,
        input.sessionId,
        input.provider,
        input.model,
        input.promptVersion,
        input.inputHash,
      ),
    );
  }

  claimAiCleanupJob(input: {
    jobId: string;
    workerId: string;
    leaseMs: number;
  }): AiCleanupJobRow | null {
    const now = isoNow();
    const lockedUntil = new Date(Date.now() + input.leaseMs).toISOString();
    let claimed: AiCleanupJobRow | null = null;

    this.database.transaction(() => {
      const result = this.database.db.prepare(
        `UPDATE ai_cleanup_jobs
         SET status = 'processing',
             attempts = attempts + 1,
             locked_by = ?,
             locked_until = ?,
             failure_kind = NULL,
             last_error = NULL,
             updated_at = ?
         WHERE id = ?
           AND status = 'queued'
           AND next_attempt_at <= ?`,
      ).run(input.workerId, lockedUntil, now, input.jobId, now) as {
        changes: number;
      };

      if (result.changes === 0) {
        return;
      }

      claimed = this.getAiCleanupJob(input.jobId);
    });

    return claimed;
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
    this.run(
      `UPDATE ai_cleanup_jobs
       SET command = COALESCE(?, command),
           prompt_path = COALESCE(?, prompt_path),
           raw_output_path = COALESCE(?, raw_output_path),
           stderr_path = COALESCE(?, stderr_path),
           parsed_json_path = COALESCE(?, parsed_json_path),
           markdown_path = COALESCE(?, markdown_path),
           output_hash = COALESCE(?, output_hash),
           updated_at = ?
       WHERE id = ?`,
      input.command ?? null,
      this.toStoredPath(input.promptPath ?? null),
      this.toStoredPath(input.rawOutputPath ?? null),
      this.toStoredPath(input.stderrPath ?? null),
      this.toStoredPath(input.parsedJsonPath ?? null),
      this.toStoredPath(input.markdownPath ?? null),
      input.outputHash ?? null,
      isoNow(),
      input.jobId,
    );
  }

  blockAiCleanupJob(input: {
    jobId: string;
    failureKind: AiCleanupFailureKind;
    error: string;
  }): void {
    this.run(
      `UPDATE ai_cleanup_jobs
       SET status = 'blocked',
           locked_by = NULL,
           locked_until = NULL,
           failure_kind = ?,
           last_error = ?,
           updated_at = ?
       WHERE id = ?`,
      input.failureKind,
      input.error,
      isoNow(),
      input.jobId,
    );
  }

  failProcessingAiCleanupJob(input: {
    jobId: string;
    failureKind: AiCleanupFailureKind;
    error: string;
  }): void {
    const job = this.getAiCleanupJob(input.jobId);
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
      `UPDATE ai_cleanup_jobs
       SET status = ?,
           locked_by = NULL,
           locked_until = NULL,
           next_attempt_at = ?,
           failure_kind = ?,
           last_error = ?,
           updated_at = ?
       WHERE id = ?`,
      shouldRetry ? "queued" : "failed",
      shouldRetry ? nextAttemptAt : now,
      input.failureKind,
      input.error,
      now,
      input.jobId,
    );
  }

  completeAiCleanupJob(input: {
    jobId: string;
    draftId: string;
    schemaVersion: string;
    language: string;
    title: string;
    summaryText: string;
    draftJson: string;
    markdown: string;
    jsonPath: string;
    markdownPath: string;
    rawOutputPath: string;
    provider: string;
    model: string;
    promptVersion: string;
    inputHash: string;
    outputHash: string;
  }): MeetingNotesDraftRow {
    const job = this.getAiCleanupJob(input.jobId);
    if (!job) {
      throw new Error(`AI cleanup job을 찾지 못했습니다: ${input.jobId}`);
    }

    const now = isoNow();
    this.database.transaction(() => {
      this.run(
        `INSERT INTO meeting_notes_drafts (
          id, session_id, ai_cleanup_job_id, schema_version, language,
          title, summary_text, draft_json, markdown, json_path,
          markdown_path, raw_output_path, provider, model, prompt_version,
          input_hash, output_hash, validation_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'valid', ?, ?)`,
        input.draftId,
        job.session_id,
        input.jobId,
        input.schemaVersion,
        input.language,
        input.title,
        input.summaryText,
        input.draftJson,
        input.markdown,
        this.toStoredPath(input.jsonPath),
        this.toStoredPath(input.markdownPath),
        this.toStoredPath(input.rawOutputPath),
        input.provider,
        input.model,
        input.promptVersion,
        input.inputHash,
        input.outputHash,
        now,
        now,
      );
      this.run(
        `UPDATE ai_cleanup_jobs
         SET status = 'done',
             locked_by = NULL,
             locked_until = NULL,
             parsed_json_path = ?,
             markdown_path = ?,
             raw_output_path = ?,
             output_hash = ?,
             failure_kind = NULL,
             last_error = NULL,
             updated_at = ?
         WHERE id = ?`,
        this.toStoredPath(input.jsonPath),
        this.toStoredPath(input.markdownPath),
        this.toStoredPath(input.rawOutputPath),
        input.outputHash,
        now,
        input.jobId,
      );
    });

    const draft = this.mapMeetingNotesDraftRow(
      this.get<MeetingNotesDraftRow>(
        "SELECT * FROM meeting_notes_drafts WHERE ai_cleanup_job_id = ?",
        input.jobId,
      ),
    );
    if (!draft) {
      throw new Error("meeting notes draft 저장에 실패했습니다.");
    }
    return draft;
  }

  releaseExpiredAiCleanupLeases(nowIso = isoNow()): number {
    const jobs = this.all<AiCleanupJobRow>(
      `SELECT *
       FROM ai_cleanup_jobs
       WHERE status = 'processing'
         AND locked_until IS NOT NULL
         AND locked_until < ?
         AND attempts < max_attempts`,
      nowIso,
    );

    for (const job of jobs) {
      this.run(
        `UPDATE ai_cleanup_jobs
         SET status = 'queued',
             locked_by = NULL,
             locked_until = NULL,
             next_attempt_at = ?,
             updated_at = ?
         WHERE id = ?`,
        nowIso,
        nowIso,
        job.id,
      );
    }

    return jobs.length;
  }

  repairExpiredAiCleanupProcessingJobs(
    nowIso = isoNow(),
  ): AiCleanupLeaseRepairSummary {
    const jobs = this.all<AiCleanupJobRow>(
      `SELECT *
       FROM ai_cleanup_jobs
       WHERE status = 'processing'
         AND locked_until IS NOT NULL
         AND locked_until < ?`,
      nowIso,
    );
    let requeued = 0;
    let failed = 0;

    for (const job of jobs) {
      if (job.attempts < job.max_attempts) {
        this.run(
          `UPDATE ai_cleanup_jobs
           SET status = 'queued',
               locked_by = NULL,
               locked_until = NULL,
               next_attempt_at = ?,
               last_error = ?,
               updated_at = ?
           WHERE id = ?`,
          nowIso,
          "AI cleanup processing lease expired; retrying.",
          nowIso,
          job.id,
        );
        requeued += 1;
        continue;
      }

      this.run(
        `UPDATE ai_cleanup_jobs
         SET status = 'failed',
             locked_by = NULL,
             locked_until = NULL,
             next_attempt_at = ?,
             failure_kind = 'provider_timeout',
             last_error = ?,
             updated_at = ?
         WHERE id = ?`,
        nowIso,
        "AI cleanup processing lease expired after max attempts.",
        nowIso,
        job.id,
      );
      failed += 1;
    }

    return { requeued, failed };
  }

  listRecentAiCleanupJobs(
    sessionId: string | null,
    limit = 20,
  ): AiCleanupJobRow[] {
    const rows = sessionId === null
      ? this.all<AiCleanupJobRow>(
          `SELECT *
           FROM ai_cleanup_jobs
           ORDER BY created_at DESC
           LIMIT ?`,
          limit,
        )
      : this.all<AiCleanupJobRow>(
          `SELECT *
           FROM ai_cleanup_jobs
           WHERE session_id = ?
           ORDER BY created_at DESC
           LIMIT ?`,
          sessionId,
          limit,
        );
    return rows.map((row) => this.mapAiCleanupJobRow(row));
  }

  getLatestMeetingNotesDraft(sessionId: string): MeetingNotesDraftRow | null {
    return this.mapMeetingNotesDraftRow(
      this.get<MeetingNotesDraftRow>(
        `SELECT *
         FROM meeting_notes_drafts
         WHERE session_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
        sessionId,
      ),
    );
  }

  getMeetingNotesDraftByJobId(jobId: string): MeetingNotesDraftRow | null {
    return this.mapMeetingNotesDraftRow(
      this.get<MeetingNotesDraftRow>(
        "SELECT * FROM meeting_notes_drafts WHERE ai_cleanup_job_id = ?",
        jobId,
      ),
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
    const candidates = uniqueStrings([
      filePath,
      path.resolve(filePath),
      this.toStoredPath(filePath),
      this.resolveStoredPath(filePath),
    ]);
    const placeholders = candidates.map(() => "?").join(", ");
    const row = this.get<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM chunks
       WHERE raw_audio_path IN (${placeholders})
          OR stt_audio_path IN (${placeholders})`,
      ...candidates,
      ...candidates,
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
    return buildDashboardReadModel({
      database: this.database,
      runtime,
      queries: {
        getSession: (sessionId) => this.getSession(sessionId),
        getLatestSession: () => this.getLatestSession(),
        listRecentTranscriptSegments: (sessionId, limit) =>
          this.listRecentTranscriptSegments(sessionId, limit),
        listRecentAiCleanupJobs: (sessionId, limit) =>
          this.listRecentAiCleanupJobs(sessionId, limit),
        getLatestMeetingNotesDraft: (sessionId) =>
          this.getLatestMeetingNotesDraft(sessionId),
      },
    });
  }

  statusText(runtime: RecordingRuntimeState, dashboardUrl: string): string {
    return buildStatusTextReadModel({
      sql: this.sql,
      runtime,
      dashboardUrl,
      getSession: (sessionId) => this.getSession(sessionId),
      getLatestSession: () => this.getLatestSession(),
    });
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
      this.toStoredPath(input.inputAudioPath),
      input.maxAttempts,
      input.now,
      input.inputAudioSha256,
      input.now,
      input.now,
    );
  }

  private normalizeStoredPaths(): void {
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
        const rowIds = this.all<{ row_id: number }>(
          `SELECT rowid AS row_id FROM ${table}`,
        );
        for (const { row_id: rowId } of rowIds) {
          for (const column of columns) {
            const row = this.get<{ value: string | null }>(
              `SELECT ${column} AS value FROM ${table} WHERE rowid = ?`,
              rowId,
            );
            const storedPath = this.toStoredPath(row?.value ?? null);
            if (storedPath === (row?.value ?? null)) {
              continue;
            }
            this.run(
              `UPDATE ${table} SET ${column} = ? WHERE rowid = ?`,
              storedPath,
              rowId,
            );
          }
        }
      }
    });
    this.normalizeRepairItemDedupeKeys();
  }

  private normalizeRepairItemDedupeKeys(): void {
    const repairItems = this.all<{
      row_id: number;
      dedupe_key: string;
      item_type: string;
      session_id: string | null;
      path: string | null;
      chunk_id: string | null;
      stt_job_id: string | null;
    }>(
      `SELECT rowid AS row_id, dedupe_key, item_type, session_id, path, chunk_id, stt_job_id
       FROM repair_items`,
    );

    for (const item of repairItems) {
      const dedupeKey = makeRepairItemDedupeKey({
        type: item.item_type,
        sessionId: item.session_id,
        path: item.path,
        chunkId: item.chunk_id,
        sttJobId: item.stt_job_id,
      });
      if (dedupeKey === item.dedupe_key) {
        continue;
      }
      this.run(
        "UPDATE OR IGNORE repair_items SET dedupe_key = ? WHERE rowid = ?",
        dedupeKey,
        item.row_id,
      );
    }
  }

  private toStoredPath(filePath: string | null): string | null {
    return this.paths.toStoredPath(filePath);
  }

  private resolveStoredPath(filePath: string | null): string | null {
    return this.paths.resolveStoredPath(filePath);
  }

  private mapSessionRow(row: SessionRow): SessionRow;
  private mapSessionRow(row: SessionRow | null): SessionRow | null;
  private mapSessionRow(row: SessionRow | null): SessionRow | null {
    return row
      ? { ...row, data_dir: this.resolveStoredPath(row.data_dir) ?? row.data_dir }
      : null;
  }

  private mapChunkRow(row: ChunkRow): ChunkRow;
  private mapChunkRow(row: ChunkRow | null): ChunkRow | null;
  private mapChunkRow(row: ChunkRow | null): ChunkRow | null {
    return row
      ? {
          ...row,
          raw_audio_path:
            this.resolveStoredPath(row.raw_audio_path) ?? row.raw_audio_path,
          stt_audio_path:
            this.resolveStoredPath(row.stt_audio_path) ?? row.stt_audio_path,
        }
      : null;
  }

  private mapSttJobRow(row: SttJobRow): SttJobRow;
  private mapSttJobRow(row: SttJobRow | null): SttJobRow | null;
  private mapSttJobRow(row: SttJobRow | null): SttJobRow | null {
    return row
      ? {
          ...row,
          input_audio_path:
            this.resolveStoredPath(row.input_audio_path) ?? row.input_audio_path,
        }
      : null;
  }

  private mapAiCleanupJobRow(row: AiCleanupJobRow): AiCleanupJobRow;
  private mapAiCleanupJobRow(row: AiCleanupJobRow | null): AiCleanupJobRow | null;
  private mapAiCleanupJobRow(
    row: AiCleanupJobRow | null,
  ): AiCleanupJobRow | null {
    return row
      ? {
          ...row,
          input_timeline_json_path:
            this.resolveStoredPath(row.input_timeline_json_path) ??
            row.input_timeline_json_path,
          input_timeline_markdown_path:
            this.resolveStoredPath(row.input_timeline_markdown_path) ??
            row.input_timeline_markdown_path,
          prompt_path:
            this.resolveStoredPath(row.prompt_path) ?? row.prompt_path,
          raw_output_path:
            this.resolveStoredPath(row.raw_output_path) ?? row.raw_output_path,
          stderr_path:
            this.resolveStoredPath(row.stderr_path) ?? row.stderr_path,
          parsed_json_path:
            this.resolveStoredPath(row.parsed_json_path) ??
            row.parsed_json_path,
          markdown_path:
            this.resolveStoredPath(row.markdown_path) ?? row.markdown_path,
        }
      : null;
  }

  private mapMeetingNotesDraftRow(row: MeetingNotesDraftRow): MeetingNotesDraftRow;
  private mapMeetingNotesDraftRow(
    row: MeetingNotesDraftRow | null,
  ): MeetingNotesDraftRow | null;
  private mapMeetingNotesDraftRow(
    row: MeetingNotesDraftRow | null,
  ): MeetingNotesDraftRow | null {
    return row
      ? {
          ...row,
          json_path: this.resolveStoredPath(row.json_path) ?? row.json_path,
          markdown_path:
            this.resolveStoredPath(row.markdown_path) ?? row.markdown_path,
          raw_output_path:
            this.resolveStoredPath(row.raw_output_path) ?? row.raw_output_path,
        }
      : null;
  }

  private run(sql: string, ...params: SqlValue[]): void {
    this.sql.run(sql, ...params);
  }

  private get<T>(sql: string, ...params: SqlValue[]): T | null {
    return this.sql.get<T>(sql, ...params);
  }

  private all<T = Record<string, unknown>>(sql: string, ...params: SqlValue[]): T[] {
    return this.sql.all<T>(sql, ...params);
  }
}

function isoNow(): string {
  return new Date().toISOString();
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function uniqueStrings(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function makeRepairItemDedupeKey(input: {
  type: string;
  sessionId: string | null;
  path: string | null;
  chunkId: string | null;
  sttJobId: string | null;
}): string {
  return [
    input.type,
    input.sessionId ?? "",
    input.path ?? "",
    input.chunkId ?? "",
    input.sttJobId ?? "",
  ].join(":");
}

export function relativeDisplayPath(filePath: string | null): string | null {
  if (!filePath) {
    return null;
  }
  return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
}
