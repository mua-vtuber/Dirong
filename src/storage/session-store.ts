import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { AiCleanupJobQueue } from "./ai-cleanup-job-queue.js";
import { buildAiCleanupSttTerminalSnapshot } from "./ai-cleanup-terminal-read-model.js";
import { ChunkRepository } from "./chunk-repository.js";
import { buildDashboardReadModel } from "./dashboard-read-model.js";
import {
  createStoragePathResolver,
  type StoragePathResolver,
} from "./path-resolver.js";
import { RepairRepository } from "./repair-repository.js";
import { SessionRepository } from "./session-repository.js";
import { SqlRunner } from "./sql-runner.js";
import { DirongDatabase, type SqlValue } from "./sqlite.js";
import { SttJobQueue } from "./stt-job-queue.js";
import { buildStatusTextReadModel } from "./status-text-read-model.js";
import type { DirongLocale } from "../settings/local-settings-store.js";

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
  private readonly aiCleanupJobs: AiCleanupJobQueue;
  private readonly chunks: ChunkRepository;
  private readonly repairs: RepairRepository;
  private readonly sessions: SessionRepository;
  private readonly sttJobs: SttJobQueue;

  constructor(
    private readonly database: DirongDatabase,
    options: SessionStoreOptions = {},
  ) {
    this.paths = createStoragePathResolver(options.storageRoot);
    this.sql = new SqlRunner(database);
    const repositoryOptions = {
      now: isoNow,
      resolveStoredPath: (filePath: string | null) =>
        this.resolveStoredPath(filePath),
      toStoredPath: (filePath: string | null) => this.toStoredPath(filePath),
    };
    this.aiCleanupJobs = new AiCleanupJobQueue(this.sql, repositoryOptions);
    this.chunks = new ChunkRepository(this.sql, repositoryOptions);
    this.repairs = new RepairRepository(this.sql, repositoryOptions);
    this.sessions = new SessionRepository(this.sql, {
      now: isoNow,
      toStoredPath: (filePath) => this.toStoredPath(filePath),
    });
    this.sttJobs = new SttJobQueue(this.sql, repositoryOptions);
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
    this.sessions.create(input);
  }

  updateSessionStatus(
    sessionId: string,
    status: SessionStatus,
    lastError?: string | null,
  ): void {
    this.sessions.updateStatus(sessionId, status, lastError);
  }

  stopSession(input: {
    sessionId: string;
    stoppedByUserId: string;
    stoppedByDisplayName: string;
    status: SessionStatus;
    lastError?: string | null;
  }): void {
    this.sessions.stop(input);
  }

  getSession(sessionId: string): SessionRow | null {
    return this.mapSessionRow(this.sessions.get(sessionId));
  }

  getLatestSession(): SessionRow | null {
    return this.mapSessionRow(this.sessions.getLatest());
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
    return this.sessions
      .listFinalizedForAiCleanupAutomation(input)
      .map((row) => this.mapSessionRow(row));
  }

  upsertSpeaker(input: {
    sessionId: string;
    userId: string;
    displayNameSnapshot: string;
    isBot: boolean;
    seenAtMs: number;
  }): void {
    this.chunks.upsertSpeaker(input);
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
    this.chunks.createWriting(input);
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
    this.chunks.finalizeRaw(input);
  }

  completeChunkTranscodeAndQueueJob(input: {
    chunkId: string;
    sttAudioPath: string;
    sttAudioFormat: string;
    sttByteSize: number;
    sttSha256: string | null;
    maxAttempts: number;
  }): void {
    this.sql.transaction(() => {
      const chunk = this.getChunk(input.chunkId);
      if (!chunk) {
        throw new Error(`chunk를 찾지 못했습니다: ${input.chunkId}`);
      }

      const now = isoNow();
      this.chunks.markTranscodedAndQueued({
        chunkId: input.chunkId,
        sttAudioPath: input.sttAudioPath,
        sttAudioFormat: input.sttAudioFormat,
        sttByteSize: input.sttByteSize,
        sttSha256: input.sttSha256,
        now,
      });

      this.sttJobs.upsertForChunk(chunk, {
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
    this.chunks.markTranscodeFailed(input);
  }

  markChunkFailed(input: {
    chunkId: string;
    error: unknown;
  }): void {
    this.chunks.markFailed(input);
  }

  getChunk(chunkId: string): ChunkRow | null {
    return this.mapChunkRow(this.chunks.get(chunkId));
  }

  listChunksMissingSttJob(): ChunkRow[] {
    return this.chunks.listMissingSttJob().map((row) => this.mapChunkRow(row));
  }

  listWritingChunks(): ChunkRow[] {
    return this.chunks.listWriting().map((row) => this.mapChunkRow(row));
  }

  queueExistingSttJobForChunk(chunkId: string, maxAttempts: number): boolean {
    const chunk = this.getChunk(chunkId);
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

  recordConnectionEvent(input: {
    sessionId: string | null;
    eventType: string;
    level?: "debug" | "info" | "warn" | "error";
    startedAtMs?: number | null;
    endedAtMs?: number | null;
    details?: unknown;
  }): void {
    this.repairs.recordConnectionEvent(input);
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
    this.repairs.recordItem(input);
  }

  failJobsWithMissingAudio(): number {
    let failed = 0;
    for (const job of this.sttJobs.listNonTerminalWithInputAudio()) {
      const inputAudioPath = this.resolveStoredPath(job.input_audio_path);
      if (inputAudioPath && existsSync(inputAudioPath)) {
        continue;
      }

      const now = isoNow();
      this.sttJobs.markMissingAudio(job.id, now);
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
    const jobs = this.sttJobs.listExpiredProcessingLeases(nowIso);
    for (const job of jobs) {
      this.sttJobs.requeueExpiredProcessingLease(job.id, nowIso);
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
    return this.mapSttJobRow(this.sttJobs.claimNext(input));
  }

  listQueuedSttJobs(input: {
    limit: number;
    sessionId?: string | null;
  }): SttJobRow[] {
    return this.sttJobs.listQueued(input).map((row) => this.mapSttJobRow(row));
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

    this.sql.transaction(() => {
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

      this.sttJobs.markDone({
        job: input.job,
        inputAudioSha256: input.inputAudioSha256 ?? null,
        now,
        resultHash,
      });
    });

    const segment = this.sttJobs.getTranscriptSegment(input.job.id);
    if (!segment) {
      throw new Error(`transcript segment 저장에 실패했습니다: ${input.job.id}`);
    }
    return segment;
  }

  markSttJobMissingAudio(job: SttJobRow): void {
    const now = isoNow();
    this.sql.transaction(() => {
      this.sttJobs.markMissingAudio(job.id, now);
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
    this.sttJobs.failProcessing(input);
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
    return this.mapAiCleanupJobRow(this.aiCleanupJobs.getOrCreate(input));
  }

  getAiCleanupJob(jobId: string): AiCleanupJobRow | null {
    return this.mapAiCleanupJobRow(this.aiCleanupJobs.get(jobId));
  }

  getAiCleanupJobByIdentity(input: {
    sessionId: string;
    provider: string;
    model: string;
    promptVersion: string;
    inputHash: string;
  }): AiCleanupJobRow | null {
    return this.mapAiCleanupJobRow(this.aiCleanupJobs.getByIdentity(input));
  }

  claimAiCleanupJob(input: {
    jobId: string;
    workerId: string;
    leaseMs: number;
  }): AiCleanupJobRow | null {
    return this.mapAiCleanupJobRow(this.aiCleanupJobs.claim(input));
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

  failProcessingAiCleanupJob(input: {
    jobId: string;
    failureKind: AiCleanupFailureKind;
    error: string;
  }): void {
    this.aiCleanupJobs.failProcessing(input);
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
    this.sql.transaction(() => {
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
      this.aiCleanupJobs.markDone({
        jobId: input.jobId,
        jsonPath: input.jsonPath,
        markdownPath: input.markdownPath,
        rawOutputPath: input.rawOutputPath,
        outputHash: input.outputHash,
        now,
      });
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
    return this.aiCleanupJobs.releaseExpiredLeases(nowIso);
  }

  repairExpiredAiCleanupProcessingJobs(
    nowIso = isoNow(),
  ): AiCleanupLeaseRepairSummary {
    return this.aiCleanupJobs.repairExpiredProcessingJobs(nowIso);
  }

  listRecentAiCleanupJobs(
    sessionId: string | null,
    limit = 20,
  ): AiCleanupJobRow[] {
    return this.aiCleanupJobs
      .listRecent(sessionId, limit)
      .map((row) => this.mapAiCleanupJobRow(row));
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
    return this.chunks.hasAudioPath(filePath);
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

  statusText(
    runtime: RecordingRuntimeState,
    dashboardUrl: string,
    locale?: DirongLocale,
  ): string {
    return buildStatusTextReadModel({
      sql: this.sql,
      runtime,
      dashboardUrl,
      locale,
      getSession: (sessionId) => this.getSession(sessionId),
      getLatestSession: () => this.getLatestSession(),
    });
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
    this.repairs.normalizeDedupeKeys();
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

export function relativeDisplayPath(filePath: string | null): string | null {
  if (!filePath) {
    return null;
  }
  return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
}
