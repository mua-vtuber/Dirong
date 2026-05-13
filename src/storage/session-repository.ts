import type { SessionRow, SessionStatus } from "./rows.js";
import type { SqlRunner } from "./sql-runner.js";

export type SessionRepositoryOptions = {
  toStoredPath(filePath: string | null): string | null;
  now(): string;
};

export class SessionRepository {
  constructor(
    private readonly sql: SqlRunner,
    private readonly options: SessionRepositoryOptions,
  ) {}

  create(input: {
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
    const now = this.options.now();
    this.sql.run(
      `INSERT INTO sessions (
        id, project_id, guild_id, guild_name, text_channel_id, voice_channel_id,
        voice_channel_name, started_by_user_id, started_by_display_name,
        status, started_at, data_dir, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'created', ?, ?, ?, ?)`,
      input.id,
      input.projectId ?? null,
      input.guildId,
      input.guildName,
      input.textChannelId,
      input.voiceChannelId,
      input.voiceChannelName,
      input.startedByUserId,
      input.startedByDisplayName,
      now,
      this.options.toStoredPath(input.dataDir),
      now,
      now,
    );
  }

  updateStatus(
    sessionId: string,
    status: SessionStatus,
    lastError?: string | null,
  ): void {
    this.sql.run(
      `UPDATE sessions
       SET status = ?, last_error = COALESCE(?, last_error), updated_at = ?
       WHERE id = ?`,
      status,
      lastError ?? null,
      this.options.now(),
      sessionId,
    );
  }

  stop(input: {
    sessionId: string;
    stoppedByUserId: string;
    stoppedByDisplayName: string;
    status: SessionStatus;
    lastError?: string | null;
  }): void {
    const now = this.options.now();
    this.sql.run(
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

  get(sessionId: string): SessionRow | null {
    return this.sql.get<SessionRow>(
      "SELECT * FROM sessions WHERE id = ?",
      sessionId,
    );
  }

  getLatest(): SessionRow | null {
    return this.sql.get<SessionRow>(
      "SELECT * FROM sessions ORDER BY started_at DESC LIMIT 1",
    );
  }

  listFinalizedForAiCleanupAutomation(
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
    const nowIso = options.nowIso ?? this.options.now();
    const provider = options.provider ?? null;
    const model = options.model ?? null;
    const promptVersion = options.promptVersion ?? null;
    return this.sql.all<SessionRow>(
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
    );
  }
}
