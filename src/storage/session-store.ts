import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { AiCleanupJobQueue } from "./ai-cleanup-job-queue.js";
import { buildAiCleanupSttTerminalSnapshot } from "./ai-cleanup-terminal-read-model.js";
import { ChunkRepository } from "./chunk-repository.js";
import { buildDashboardReadModel } from "./dashboard-read-model.js";
import { MeetingNotesDraftRepository } from "./meeting-notes-draft-repository.js";
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
import { TranscriptRepository } from "./transcript-repository.js";
import type { DirongLocale } from "../settings/local-settings-store.js";
import type {
  AiCleanupFailureKind,
  AiCleanupJobRow,
  AiCleanupLeaseRepairSummary,
  AiCleanupSttTerminalSnapshot,
  ChunkRow,
  MeetingNotesDraftRow,
  RecordingRuntimeState,
  SessionRow,
  SessionStatus,
  SpeechStatus,
  SttJobRow,
  TranscriptSegmentRow,
} from "./rows.js";

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

export type SessionStoreOptions = {
  storageRoot?: string | null;
  normalizeStoredPaths?: boolean;
};

export class SessionStore {
  private readonly paths: StoragePathResolver;
  private readonly sql: SqlRunner;
  private readonly aiCleanupJobs: AiCleanupJobQueue;
  private readonly chunks: ChunkRepository;
  private readonly meetingNotesDrafts: MeetingNotesDraftRepository;
  private readonly repairs: RepairRepository;
  private readonly sessions: SessionRepository;
  private readonly sttJobs: SttJobQueue;
  private readonly transcripts: TranscriptRepository;

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
    this.meetingNotesDrafts = new MeetingNotesDraftRepository(
      this.sql,
      repositoryOptions,
    );
    this.repairs = new RepairRepository(this.sql, repositoryOptions);
    this.sessions = new SessionRepository(this.sql, {
      now: isoNow,
      toStoredPath: (filePath) => this.toStoredPath(filePath),
    });
    this.sttJobs = new SttJobQueue(this.sql, repositoryOptions);
    this.transcripts = new TranscriptRepository(this.sql);
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
      this.transcripts.upsertSegmentForSttJob({
        id: segmentId,
        sessionId: input.job.session_id,
        chunkId: input.job.chunk_id,
        sttJobId: input.job.id,
        userId: input.job.user_id,
        displayNameSnapshot: input.job.display_name_snapshot,
        startMs,
        endMs,
        text: input.text,
        speechStatus,
        source: input.source,
        provider: input.provider,
        model: input.model,
        inputAudioSha256: input.inputAudioSha256 ?? input.job.input_audio_sha256,
        now,
      });

      this.sttJobs.markDone({
        job: input.job,
        inputAudioSha256: input.inputAudioSha256 ?? null,
        now,
        resultHash,
      });
    });

    const segment = this.transcripts.getBySttJobId(input.job.id);
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
    return this.transcripts.listRecent(sessionId, limit);
  }

  listTranscriptTimelineSegments(input: {
    sessionId: string;
    includeNoSpeech?: boolean;
    includeFakeStt?: boolean;
  }): TranscriptSegmentRow[] {
    return this.transcripts.listTimeline(input);
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
      this.meetingNotesDrafts.insertValid({
        id: input.draftId,
        sessionId: job.session_id,
        aiCleanupJobId: input.jobId,
        schemaVersion: input.schemaVersion,
        language: input.language,
        title: input.title,
        summaryText: input.summaryText,
        draftJson: input.draftJson,
        markdown: input.markdown,
        jsonPath: input.jsonPath,
        markdownPath: input.markdownPath,
        rawOutputPath: input.rawOutputPath,
        provider: input.provider,
        model: input.model,
        promptVersion: input.promptVersion,
        inputHash: input.inputHash,
        outputHash: input.outputHash,
        now,
      });
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
      this.meetingNotesDrafts.getByJobId(input.jobId),
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
      this.meetingNotesDrafts.getLatestBySession(sessionId),
    );
  }

  getMeetingNotesDraftByJobId(jobId: string): MeetingNotesDraftRow | null {
    return this.mapMeetingNotesDraftRow(
      this.meetingNotesDrafts.getByJobId(jobId),
    );
  }

  listRecentTranscriptTextForSpeaker(input: {
    sessionId: string;
    userId: string;
    beforeStartMs: number;
    limit: number;
    sources?: string[];
  }): string[] {
    return this.transcripts.listRecentTextForSpeaker(input);
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
