import { AiCleanupJobQueue } from "./ai-cleanup-job-queue.js";
import { buildAiCleanupSttTerminalSnapshot } from "./ai-cleanup-terminal-read-model.js";
import { ChunkRepository } from "./chunk-repository.js";
import { buildDashboardReadModel } from "./dashboard-read-model.js";
import { MeetingNotesDraftRepository } from "./meeting-notes-draft-repository.js";
import {
  mapAiCleanupJobRow,
  mapChunkRow,
  mapMeetingNotesDraftRow,
  mapSessionRow,
  mapSttJobRow,
} from "./path-mapping.js";
import type { StoragePathResolver } from "./path-resolver.js";
import { SessionRepository } from "./session-repository.js";
import { SqlRunner } from "./sql-runner.js";
import { SttJobQueue } from "./stt-job-queue.js";
import { isoNow } from "./store-helpers.js";
import { buildStatusTextReadModel } from "./status-text-read-model.js";
import type { DirongDatabase } from "./sqlite.js";
import { TranscriptRepository } from "./transcript-repository.js";
import type { DirongLocale } from "../settings/local-settings-store.js";
import type {
  AiCleanupJobRow,
  AiCleanupSttTerminalSnapshot,
  ChunkRow,
  MeetingNotesDraftRow,
  RecordingRuntimeState,
  SessionRow,
  SttJobRow,
  TranscriptSegmentRow,
} from "./rows.js";

// SessionReadStore — facade exposing the READ surface of the legacy SessionStore.
// Includes the three read-models (`dashboard`, `status-text`, `ai-cleanup-terminal`)
// and the raw session/chunk/transcript/job/draft reads. Path normalization runs
// inside the facade (mapXxxRow free functions in path-mapping.ts) so callers see
// resolved absolute paths.
//
// Constructor takes `database: DirongDatabase` only because the dashboard read
// model performs ad-hoc `SELECT` queries via the database (see
// dashboard-read-model.ts:9) — pure reads, no transaction wrapping.

export class SessionReadStore {
  private readonly aiCleanupJobs: AiCleanupJobQueue;
  private readonly chunks: ChunkRepository;
  private readonly meetingNotesDrafts: MeetingNotesDraftRepository;
  private readonly sessions: SessionRepository;
  private readonly sttJobs: SttJobQueue;
  private readonly transcripts: TranscriptRepository;

  constructor(
    private readonly sql: SqlRunner,
    private readonly paths: StoragePathResolver,
    private readonly database: DirongDatabase,
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
    this.sessions = new SessionRepository(this.sql, {
      now: isoNow,
      toStoredPath: (filePath) => this.paths.toStoredPath(filePath),
    });
    this.sttJobs = new SttJobQueue(this.sql, repositoryOptions);
    this.transcripts = new TranscriptRepository(this.sql);
  }

  // —— session reads ——————————————————————————————————————————

  getSession(sessionId: string): SessionRow | null {
    return mapSessionRow(this.sessions.get(sessionId), (filePath) =>
      this.paths.resolveStoredPath(filePath),
    );
  }

  getLatestSession(): SessionRow | null {
    return mapSessionRow(this.sessions.getLatest(), (filePath) =>
      this.paths.resolveStoredPath(filePath),
    );
  }

  getLatestSessionForProject(projectId: string): SessionRow | null {
    return mapSessionRow(
      this.sessions.getLatestForProject(projectId),
      (filePath) => this.paths.resolveStoredPath(filePath),
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
    return this.sessions
      .listFinalizedForAiCleanupAutomation(input)
      .map((row) =>
        mapSessionRow(row, (filePath) =>
          this.paths.resolveStoredPath(filePath),
        ),
      );
  }

  // —— chunk reads ————————————————————————————————————————————

  getChunk(chunkId: string): ChunkRow | null {
    return mapChunkRow(this.chunks.get(chunkId), (filePath) =>
      this.paths.resolveStoredPath(filePath),
    );
  }

  listChunksMissingSttJob(): ChunkRow[] {
    return this.chunks
      .listMissingSttJob()
      .map((row) =>
        mapChunkRow(row, (filePath) => this.paths.resolveStoredPath(filePath)),
      );
  }

  listWritingChunks(): ChunkRow[] {
    return this.chunks
      .listWriting()
      .map((row) =>
        mapChunkRow(row, (filePath) => this.paths.resolveStoredPath(filePath)),
      );
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

  // —— transcript reads ——————————————————————————————————————

  listRecentTranscriptSegments(
    sessionId: string | null,
    limit = 30,
  ): TranscriptSegmentRow[] {
    return this.transcripts.listRecent(sessionId, limit);
  }

  listTranscriptTimelineSegments(input: {
    sessionId: string;
    includeNoSpeech?: boolean;
    includeFakeStt?: boolean;
  }): TranscriptSegmentRow[] {
    return this.transcripts.listTimeline(input);
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

  // —— STT-job reads ——————————————————————————————————————————

  listQueuedSttJobs(input: {
    limit: number;
    sessionId?: string | null;
  }): SttJobRow[] {
    return this.sttJobs
      .listQueued(input)
      .map((row) =>
        mapSttJobRow(row, (filePath) => this.paths.resolveStoredPath(filePath)),
      );
  }

  // —— AI-cleanup-job reads ——————————————————————————————————

  getAiCleanupJob(jobId: string): AiCleanupJobRow | null {
    return mapAiCleanupJobRow(this.aiCleanupJobs.get(jobId), (filePath) =>
      this.paths.resolveStoredPath(filePath),
    );
  }

  getAiCleanupJobByIdentity(input: {
    sessionId: string;
    provider: string;
    model: string;
    promptVersion: string;
    inputHash: string;
  }): AiCleanupJobRow | null {
    return mapAiCleanupJobRow(
      this.aiCleanupJobs.getByIdentity(input),
      (filePath) => this.paths.resolveStoredPath(filePath),
    );
  }

  listRecentAiCleanupJobs(
    sessionId: string | null,
    limit = 20,
  ): AiCleanupJobRow[] {
    return this.aiCleanupJobs
      .listRecent(sessionId, limit)
      .map((row) =>
        mapAiCleanupJobRow(row, (filePath) =>
          this.paths.resolveStoredPath(filePath),
        ),
      );
  }

  // —— draft reads ————————————————————————————————————————————

  getLatestMeetingNotesDraft(sessionId: string): MeetingNotesDraftRow | null {
    return mapMeetingNotesDraftRow(
      this.meetingNotesDrafts.getLatestBySession(sessionId),
      (filePath) => this.paths.resolveStoredPath(filePath),
    );
  }

  getMeetingNotesDraftByJobId(jobId: string): MeetingNotesDraftRow | null {
    return mapMeetingNotesDraftRow(
      this.meetingNotesDrafts.getByJobId(jobId),
      (filePath) => this.paths.resolveStoredPath(filePath),
    );
  }

  // —— composite read models ————————————————————————————————

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

  getDashboardState(
    runtime: RecordingRuntimeState,
    activeProjectId: string | null,
  ): unknown {
    return buildDashboardReadModel({
      database: this.database,
      runtime,
      activeProjectId,
      queries: {
        getSession: (sessionId) => this.getSession(sessionId),
        getLatestSession: () => this.getLatestSession(),
        getLatestSessionForProject: (projectId) =>
          this.getLatestSessionForProject(projectId),
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
}
