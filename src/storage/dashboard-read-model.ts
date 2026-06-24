import { redactForJson } from "../errors.js";
import type {
  AiCleanupJobRow,
  MeetingNotesDraftRow,
  RecordingRuntimeState,
  SessionRow,
  TranscriptSegmentRow,
} from "./rows.js";
import type { DirongDatabase, SqlValue } from "./sqlite.js";

export type DashboardReadModelQueries = {
  getSession: (sessionId: string) => SessionRow | null;
  getLatestSession: () => SessionRow | null;
  getLatestSessionForProject: (projectId: string) => SessionRow | null;
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
  activeProjectId: string | null;
  queries: DashboardReadModelQueries;
}): unknown {
  const { activeProjectId, database, queries, runtime } = input;
  // currentSession precedence:
  //   - runtime.sessionId set → use that session as-is. The runtime guarantees
  //     the in-progress recording belongs to the active project; preserving it
  //     keeps the live view from blanking out during a project switch. The
  //     rare window where runtime.sessionId's project_id differs from
  //     activeProjectId (recording on A while the user switches to B) resolves
  //     itself on the next refresh.
  //   - no runtime session but an active project → latest session of that
  //     project. NOT the global latest (that is the bug this scoping fixes).
  //   - neither → null → empty state (no global fallback).
  const currentSession =
    runtime.sessionId !== null
      ? queries.getSession(runtime.sessionId)
      : activeProjectId !== null
        ? queries.getLatestSessionForProject(activeProjectId)
        : null;
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
  // Project-scoped: only the active session's connection events. When there is
  // no session (empty state) we return [] rather than the global last-30, which
  // would leak other projects' events and session-less system events
  // (e.g. startup_repair_failed, session_id=null). Those system events are not
  // attributable to a project and are excluded from project-scoped views by the
  // same policy as orphan repair items.
  const recentConnectionEvents =
    sessionId === null
      ? []
      : all(
          database,
          `SELECT *
           FROM connection_events
           WHERE session_id = ?
           ORDER BY created_at DESC
           LIMIT 30`,
          sessionId,
        );
  // Current-session-scoped, consistent with the sibling panels (speakers,
  // recentChunks, recentConnectionEvents) which all key off the active session.
  // A project-wide variant was unreachable: stt_jobs.session_id is NOT NULL with
  // an ON DELETE CASCADE FK to sessions, so any existing stt_job implies an
  // existing session — which makes getLatestSessionForProject return non-null and
  // sessionId non-null. The only way sessionId is null here is a project with zero
  // sessions, where a project-wide JOIN would return zero rows anyway. So [] on a
  // null session is the correct, complete result (no global fallback).
  const recentSttJobs =
    sessionId === null
      ? []
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
  // Project-scoped via INNER JOIN on sessions. repair_items.session_id is
  // nullable (ON DELETE SET NULL), so the INNER JOIN drops orphan items
  // (session_id=null) — they belong to no project and must not leak into any
  // project's view. A LEFT JOIN would re-admit those orphans, so it is wrong
  // here. activeProjectId=null → [] (empty state, no global fallback).
  const recentRepairItems =
    activeProjectId === null
      ? []
      : all(
          database,
          `SELECT r.*
           FROM repair_items r
           JOIN sessions s ON s.id = r.session_id
           WHERE r.status <> 'ignored'
             AND s.project_id = ?
           ORDER BY r.updated_at DESC
           LIMIT 30`,
          activeProjectId,
        );
  // Project-scoped queue stats: stt_jobs.session_id is NOT NULL, the INNER JOIN
  // restricts the counts to the active project's sessions.
  const queueStats =
    activeProjectId === null
      ? []
      : all(
          database,
          `SELECT j.status, COUNT(*) AS count
           FROM stt_jobs j
           JOIN sessions s ON s.id = j.session_id
           WHERE s.project_id = ?
           GROUP BY j.status
           ORDER BY j.status ASC`,
          activeProjectId,
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
