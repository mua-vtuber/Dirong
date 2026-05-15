import { AiCleanupJobQueue } from "./ai-cleanup-job-queue.js";
import { ChunkRepository } from "./chunk-repository.js";
import { MeetingNotesDraftRepository } from "./meeting-notes-draft-repository.js";
import { mapAiCleanupJobRow, mapMeetingNotesDraftRow } from "./path-mapping.js";
import type { StoragePathResolver } from "./path-resolver.js";
import { RepairRepository } from "./repair-repository.js";
import { SessionRepository } from "./session-repository.js";
import { SqlRunner } from "./sql-runner.js";
import { SttJobQueue } from "./stt-job-queue.js";
import { isoNow, sha256Text } from "./store-helpers.js";
import { TranscriptRepository } from "./transcript-repository.js";
import type {
  MeetingNotesDraftRow,
  SessionStatus,
  SpeechStatus,
  SttJobRow,
  TranscriptSegmentRow,
} from "./rows.js";

// SessionWriteStore — facade exposing the WRITE surface of the legacy SessionStore.
// Method signatures are BYTE-IDENTICAL to the SessionStore methods they replace;
// the bodies are extracted verbatim. The seam repositories (Session/Chunk/Stt/
// AiCleanup/MeetingNotesDraft/Repair/Transcript) are constructed internally and
// share the injected `SqlRunner` per the CONTEXT.md lock ("facades share a single
// SqlRunner instance per DirongDatabase").

export class SessionWriteStore {
  private readonly aiCleanupJobs: AiCleanupJobQueue;
  private readonly chunks: ChunkRepository;
  private readonly meetingNotesDrafts: MeetingNotesDraftRepository;
  private readonly repairs: RepairRepository;
  private readonly sessions: SessionRepository;
  private readonly sttJobs: SttJobQueue;
  private readonly transcripts: TranscriptRepository;

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
    this.meetingNotesDrafts = new MeetingNotesDraftRepository(
      this.sql,
      repositoryOptions,
    );
    this.repairs = new RepairRepository(this.sql, repositoryOptions);
    this.sessions = new SessionRepository(this.sql, {
      now: isoNow,
      toStoredPath: (filePath) => this.paths.toStoredPath(filePath),
    });
    this.sttJobs = new SttJobQueue(this.sql, repositoryOptions);
    this.transcripts = new TranscriptRepository(this.sql);
  }

  // —— session lifecycle ——————————————————————————————————————

  createSession(input: {
    id: string;
    projectId?: string | null;
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

  // —— speakers + chunks ——————————————————————————————————————

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
      const chunk = this.chunks.get(input.chunkId);
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

  markChunkTranscodeFailed(input: { chunkId: string; error: string }): void {
    this.chunks.markTranscodeFailed(input);
  }

  markChunkFailed(input: { chunkId: string; error: unknown }): void {
    this.chunks.markFailed(input);
  }

  // —— repair items ——————————————————————————————————————————

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

  // —— STT job completion ————————————————————————————————————

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
    const chunk = this.chunks.get(input.job.chunk_id);
    if (!chunk) {
      throw new Error(
        `STT job의 chunk를 찾지 못했습니다: ${input.job.chunk_id}`,
      );
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
        inputAudioSha256:
          input.inputAudioSha256 ?? input.job.input_audio_sha256,
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
      throw new Error(
        `transcript segment 저장에 실패했습니다: ${input.job.id}`,
      );
    }
    return segment;
  }

  markSttJobMissingAudio(job: SttJobRow): void {
    const now = isoNow();
    this.sql.transaction(() => {
      this.sttJobs.markMissingAudio(job.id, now);
      this.repairs.recordItem({
        type: "stt_job_missing_audio",
        sessionId: job.session_id,
        chunkId: job.chunk_id,
        sttJobId: job.id,
        path: this.paths.resolveStoredPath(job.input_audio_path),
        severity: "error",
        details: { previousStatus: job.status },
      });
    });
  }

  failProcessingSttJob(input: { jobId: string; error: string }): void {
    this.sttJobs.failProcessing(input);
  }

  // —— AI cleanup job completion ——————————————————————————————

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
    const jobRaw = this.aiCleanupJobs.get(input.jobId);
    const job = mapAiCleanupJobRow(jobRaw, (filePath) =>
      this.paths.resolveStoredPath(filePath),
    );
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

    const draft = mapMeetingNotesDraftRow(
      this.meetingNotesDrafts.getByJobId(input.jobId),
      (filePath) => this.paths.resolveStoredPath(filePath),
    );
    if (!draft) {
      throw new Error("meeting notes draft 저장에 실패했습니다.");
    }
    return draft;
  }
}
