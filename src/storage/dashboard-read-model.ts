import { redactForJson } from "../errors.js";
import type {
  AiCleanupJobRow,
  MeetingNotesDraftRow,
  RecordingRuntimeState,
  SessionRow,
  TranscriptSegmentRow,
} from "./session-store.js";
import type { DirongDatabase, SqlValue } from "./sqlite.js";

export type DashboardReadModelQueries = {
  getSession: (sessionId: string) => SessionRow | null;
  getLatestSession: () => SessionRow | null;
  listRecentTranscriptSegments: (
    sessionId: string | null,
    limit: number,
  ) => TranscriptSegmentRow[];
  listRecentAiCleanupJobs: (
    sessionId: string | null,
    limit: number,
  ) => AiCleanupJobRow[];
  getLatestMeetingNotesDraft: (
    sessionId: string,
  ) => MeetingNotesDraftRow | null;
};

export function buildDashboardReadModel(input: {
  database: DirongDatabase;
  runtime: RecordingRuntimeState;
  queries: DashboardReadModelQueries;
}): unknown {
  const { database, queries, runtime } = input;
  const currentSession =
    runtime.sessionId !== null
      ? queries.getSession(runtime.sessionId)
      : queries.getLatestSession();
  const sessionId = currentSession?.id ?? null;
  const speakers =
    sessionId === null
      ? []
      : all(
          database,
          `SELECT *
           FROM session_speakers
           WHERE session_id = ?
           ORDER BY first_seen_at_ms ASC`,
          sessionId,
        );
  const recentChunks =
    sessionId === null
      ? []
      : all(
          database,
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
  const recentConnectionEvents = all(
    database,
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
      ? all(
          database,
          `SELECT j.*, c.duration_ms, c.stt_byte_size
           FROM stt_jobs j
           LEFT JOIN chunks c ON c.id = j.chunk_id
           ORDER BY j.created_at DESC
           LIMIT 30`,
        )
      : all(
          database,
          `SELECT j.*, c.duration_ms, c.stt_byte_size
           FROM stt_jobs j
           LEFT JOIN chunks c ON c.id = j.chunk_id
           WHERE j.session_id = ?
           ORDER BY j.created_at DESC
           LIMIT 30`,
          sessionId,
        );
  const recentRepairItems = all(
    database,
    `SELECT *
     FROM repair_items
     WHERE status <> 'ignored'
     ORDER BY updated_at DESC
     LIMIT 30`,
  );
  const queueStats = all(
    database,
    `SELECT status, COUNT(*) AS count
     FROM stt_jobs
     GROUP BY status
     ORDER BY status ASC`,
  );
  const recentTranscriptSegments = queries.listRecentTranscriptSegments(
    sessionId,
    30,
  );
  const recentAiCleanupJobs = queries.listRecentAiCleanupJobs(sessionId, 10);
  const latestMeetingNotesDraft =
    sessionId === null ? null : queries.getLatestMeetingNotesDraft(sessionId);
  const latestNotionWrite =
    sessionId === null
      ? null
      : database.db.prepare(
          `SELECT *
           FROM notion_writes
           WHERE session_id = ?
           ORDER BY created_at DESC
           LIMIT 1`,
        ).get(sessionId) ?? null;

  return redactForJson({
    generatedAt: new Date().toISOString(),
    runtime,
    currentSession,
    speakers,
    recentChunks,
    recentSttJobs,
    recentConnectionEvents,
    recentRepairItems,
    recentTranscriptSegments,
    recentAiCleanupJobs,
    latestMeetingNotesDraft,
    latestNotionWrite,
    queueStats,
    dbPath: database.dbPath,
  });
}

function all<T = Record<string, unknown>>(
  database: DirongDatabase,
  sql: string,
  ...params: SqlValue[]
): T[] {
  return database.db.prepare(sql).all(...params) as T[];
}
