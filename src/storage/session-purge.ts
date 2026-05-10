import { existsSync } from "node:fs";
import { createStoragePathResolver } from "./path-resolver.js";
import type { DirongDatabase, SqlValue } from "./sqlite.js";

export type SessionPurgeSelector =
  | { kind: "sessions"; sessionIds: readonly string[] }
  | { kind: "missing-audio" }
  | { kind: "all" };

export type SessionPurgeCandidate = {
  sessionId: string;
  status: string;
  startedAt: string;
  updatedAt: string;
  dataDir: string;
  dataDirExists: boolean;
  chunkCount: number;
  missingRawAudioCount: number;
  missingSttAudioCount: number;
  sttJobCount: number;
  transcriptSegmentCount: number;
  aiCleanupJobCount: number;
  meetingNotesDraftCount: number;
  notionWriteCount: number;
  connectionEventCount: number;
  repairItemCount: number;
};

export type SessionPurgeCounts = {
  sessions: number;
  sessionSpeakers: number;
  chunks: number;
  sttJobs: number;
  transcriptSegments: number;
  aiCleanupJobs: number;
  meetingNotesDrafts: number;
  notionWrites: number;
  notionBlocks: number;
  connectionEvents: number;
  repairItems: number;
  notionCustomPropertyRules: number;
};

export type SessionPurgeResult = {
  dryRun: boolean;
  candidates: SessionPurgeCandidate[];
  counts: SessionPurgeCounts;
};

type SessionRow = {
  id: string;
  status: string;
  started_at: string;
  updated_at: string;
  data_dir: string;
};

export function previewSessionPurge(input: {
  database: DirongDatabase;
  storageRoot: string | null;
  selector: SessionPurgeSelector;
}): SessionPurgeResult {
  const candidates = selectCandidates(input);
  return {
    dryRun: true,
    candidates,
    counts: countPurgeRows(input.database, candidates.map((row) => row.sessionId)),
  };
}

export function purgeSessions(input: {
  database: DirongDatabase;
  storageRoot: string | null;
  selector: SessionPurgeSelector;
  dryRun: boolean;
}): SessionPurgeResult {
  const candidates = selectCandidates(input);
  const sessionIds = candidates.map((row) => row.sessionId);
  const counts = countPurgeRows(input.database, sessionIds);

  if (!input.dryRun && sessionIds.length > 0) {
    input.database.transaction(() => {
      runDeleteForSessions(
        input.database,
        `DELETE FROM repair_items
         WHERE session_id IN (${placeholders(sessionIds)})
            OR chunk_id IN (
              SELECT id FROM chunks WHERE session_id IN (${placeholders(sessionIds)})
            )
            OR stt_job_id IN (
              SELECT id FROM stt_jobs WHERE session_id IN (${placeholders(sessionIds)})
            )`,
        sessionIds,
        sessionIds,
        sessionIds,
      );
      runDeleteForSessions(
        input.database,
        `DELETE FROM connection_events
         WHERE session_id IN (${placeholders(sessionIds)})`,
        sessionIds,
      );
      runDeleteForSessions(
        input.database,
        `DELETE FROM sessions
         WHERE id IN (${placeholders(sessionIds)})`,
        sessionIds,
      );
    });
  }

  return { dryRun: input.dryRun, candidates, counts };
}

function selectCandidates(input: {
  database: DirongDatabase;
  storageRoot: string | null;
  selector: SessionPurgeSelector;
}): SessionPurgeCandidate[] {
  const rows = selectSessionRows(input.database, input.selector);
  const resolver = createStoragePathResolver(input.storageRoot);
  const candidates = rows.map((row) =>
    buildCandidate(input.database, resolver, row),
  );

  if (input.selector.kind !== "missing-audio") {
    return candidates;
  }

  return candidates.filter(
    (candidate) =>
      !candidate.dataDirExists ||
      candidate.missingRawAudioCount > 0 ||
      candidate.missingSttAudioCount > 0,
  );
}

function selectSessionRows(
  database: DirongDatabase,
  selector: SessionPurgeSelector,
): SessionRow[] {
  if (selector.kind === "sessions") {
    const sessionIds = uniqueNonEmpty(selector.sessionIds);
    if (sessionIds.length === 0) {
      return [];
    }
    return database.db.prepare(
      `SELECT id, status, started_at, updated_at, data_dir
       FROM sessions
       WHERE id IN (${placeholders(sessionIds)})
       ORDER BY started_at DESC`,
    ).all(...sessionIds) as SessionRow[];
  }

  return database.db.prepare(
    `SELECT id, status, started_at, updated_at, data_dir
     FROM sessions
     ORDER BY started_at DESC`,
  ).all() as SessionRow[];
}

function buildCandidate(
  database: DirongDatabase,
  resolver: ReturnType<typeof createStoragePathResolver>,
  row: SessionRow,
): SessionPurgeCandidate {
  const dataDir = resolver.resolveStoredPath(row.data_dir) ?? row.data_dir;
  const chunks = database.db.prepare(
    `SELECT raw_audio_path, stt_audio_path
     FROM chunks
     WHERE session_id = ?`,
  ).all(row.id) as Array<{
    raw_audio_path: string;
    stt_audio_path: string | null;
  }>;
  const resolvePath = (filePath: string | null): string | null =>
    resolver.resolveStoredPath(filePath) ?? filePath;

  return {
    sessionId: row.id,
    status: row.status,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    dataDir,
    dataDirExists: existsSync(dataDir),
    chunkCount: chunks.length,
    missingRawAudioCount: chunks.filter((chunk) => {
      const rawPath = resolvePath(chunk.raw_audio_path);
      return !rawPath || !existsSync(rawPath);
    }).length,
    missingSttAudioCount: chunks.filter((chunk) => {
      const sttPath = resolvePath(chunk.stt_audio_path);
      return sttPath !== null && !existsSync(sttPath);
    }).length,
    sttJobCount: countBySession(database, "stt_jobs", row.id),
    transcriptSegmentCount: countBySession(database, "transcript_segments", row.id),
    aiCleanupJobCount: countBySession(database, "ai_cleanup_jobs", row.id),
    meetingNotesDraftCount: countBySession(database, "meeting_notes_drafts", row.id),
    notionWriteCount: countBySession(database, "notion_writes", row.id),
    connectionEventCount: countBySession(database, "connection_events", row.id),
    repairItemCount: countBySession(database, "repair_items", row.id),
  };
}

function countPurgeRows(
  database: DirongDatabase,
  sessionIds: readonly string[],
): SessionPurgeCounts {
  const ids = uniqueNonEmpty(sessionIds);
  if (ids.length === 0) {
    return zeroCounts(countNotionCustomPropertyRules(database));
  }

  return {
    sessions: countIn(database, "sessions", "id", ids),
    sessionSpeakers: countIn(database, "session_speakers", "session_id", ids),
    chunks: countIn(database, "chunks", "session_id", ids),
    sttJobs: countIn(database, "stt_jobs", "session_id", ids),
    transcriptSegments: countIn(database, "transcript_segments", "session_id", ids),
    aiCleanupJobs: countIn(database, "ai_cleanup_jobs", "session_id", ids),
    meetingNotesDrafts: countIn(database, "meeting_notes_drafts", "session_id", ids),
    notionWrites: countIn(database, "notion_writes", "session_id", ids),
    notionBlocks: countNotionBlocksForSessions(database, ids),
    connectionEvents: countIn(database, "connection_events", "session_id", ids),
    repairItems: countRepairItemsForSessions(database, ids),
    notionCustomPropertyRules: countNotionCustomPropertyRules(database),
  };
}

function zeroCounts(notionCustomPropertyRules: number): SessionPurgeCounts {
  return {
    sessions: 0,
    sessionSpeakers: 0,
    chunks: 0,
    sttJobs: 0,
    transcriptSegments: 0,
    aiCleanupJobs: 0,
    meetingNotesDrafts: 0,
    notionWrites: 0,
    notionBlocks: 0,
    connectionEvents: 0,
    repairItems: 0,
    notionCustomPropertyRules,
  };
}

function countBySession(
  database: DirongDatabase,
  tableName: string,
  sessionId: string,
): number {
  return countWhere(database, `SELECT COUNT(*) AS count FROM ${tableName} WHERE session_id = ?`, sessionId);
}

function countIn(
  database: DirongDatabase,
  tableName: string,
  columnName: string,
  values: readonly string[],
): number {
  return countWhere(
    database,
    `SELECT COUNT(*) AS count
     FROM ${tableName}
     WHERE ${columnName} IN (${placeholders(values)})`,
    ...values,
  );
}

function countNotionBlocksForSessions(
  database: DirongDatabase,
  sessionIds: readonly string[],
): number {
  return countWhere(
    database,
    `SELECT COUNT(*) AS count
     FROM notion_blocks
     WHERE notion_write_id IN (
       SELECT id FROM notion_writes WHERE session_id IN (${placeholders(sessionIds)})
     )`,
    ...sessionIds,
  );
}

function countRepairItemsForSessions(
  database: DirongDatabase,
  sessionIds: readonly string[],
): number {
  return countWhere(
    database,
    `SELECT COUNT(*) AS count
     FROM repair_items
     WHERE session_id IN (${placeholders(sessionIds)})
        OR chunk_id IN (
          SELECT id FROM chunks WHERE session_id IN (${placeholders(sessionIds)})
        )
        OR stt_job_id IN (
          SELECT id FROM stt_jobs WHERE session_id IN (${placeholders(sessionIds)})
        )`,
    ...sessionIds,
    ...sessionIds,
    ...sessionIds,
  );
}

function countNotionCustomPropertyRules(database: DirongDatabase): number {
  return countWhere(
    database,
    "SELECT COUNT(*) AS count FROM notion_custom_property_rules",
  );
}

function countWhere(
  database: DirongDatabase,
  sql: string,
  ...params: SqlValue[]
): number {
  const row = database.db.prepare(sql).get(...params) as
    | { count: number }
    | undefined;
  return row?.count ?? 0;
}

function runDeleteForSessions(
  database: DirongDatabase,
  sql: string,
  ...params: readonly string[][]
): void {
  database.db.prepare(sql).run(...params.flat());
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => "?").join(", ");
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
