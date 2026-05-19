import { formatLocaleText } from "../i18n/catalog.js";
import type {
  AiCleanupSttTerminalSnapshot,
  SessionRow,
  TranscriptSegmentRow,
} from "./rows.js";
import { SqlRunner } from "./sql-runner.js";

export type AiCleanupTerminalReadModelInput = {
  sql: SqlRunner;
  sessionId: string;
  session: SessionRow | null;
  listTranscriptTimelineSegments: (input: {
    sessionId: string;
    includeNoSpeech?: boolean;
    includeFakeStt?: boolean;
  }) => TranscriptSegmentRow[];
};

export function buildAiCleanupSttTerminalSnapshot(
  input: AiCleanupTerminalReadModelInput,
): AiCleanupSttTerminalSnapshot | null {
  const { session, sessionId, sql } = input;
  if (!session || session.status !== "finalized") {
    return null;
  }

  const openChunkCount = sql.get<{ count: number }>(
    "SELECT COUNT(*) AS count FROM chunks WHERE session_id = ? AND status = 'writing'",
    sessionId,
  )?.count ?? 0;

  const statusRows = sql.all<{ status: string; count: number }>(
    `SELECT status, COUNT(*) AS count
     FROM stt_jobs
     WHERE session_id = ?
     GROUP BY status`,
    sessionId,
  );
  const sttStatusCounts = new Map(
    statusRows.map((row) => [row.status, row.count]),
  );
  const sttQueuedCount = sttStatusCounts.get("queued") ?? 0;
  const sttProcessingCount = sttStatusCounts.get("processing") ?? 0;
  const sttDoneCount = sttStatusCounts.get("done") ?? 0;
  const sttFailedCount = sttStatusCounts.get("failed") ?? 0;
  const sttFailedMissingFileCount =
    sttStatusCounts.get("failed_missing_file") ?? 0;
  const terminalSttStatuses = new Set([
    "done",
    "failed",
    "failed_missing_file",
  ]);
  const waitingSttStatuses = new Set(["queued", "processing"]);
  const sttOtherNonTerminalCount = statusRows
    .filter(
      (row) =>
        !terminalSttStatuses.has(row.status) &&
        !waitingSttStatuses.has(row.status),
    )
    .reduce((sum, row) => sum + row.count, 0);

  const chunksMissingSttJobCount = sql.get<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM chunks c
     LEFT JOIN stt_jobs j ON j.chunk_id = c.id
     WHERE c.session_id = ?
       AND c.status IN ('finalized', 'queued', 'transcode_failed')
       AND j.id IS NULL`,
    sessionId,
  )?.count ?? 0;

  const chunksWithTranscodeFailedCount = sql.get<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM chunks
     WHERE session_id = ?
       AND (transcode_status = 'failed' OR status = 'transcode_failed')`,
    sessionId,
  )?.count ?? 0;

  const chunksMissingSttAudioCount = sql.get<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM chunks
     WHERE session_id = ?
       AND status IN ('finalized', 'queued', 'transcode_failed')
       AND (stt_audio_path IS NULL OR length(trim(stt_audio_path)) = 0)`,
    sessionId,
  )?.count ?? 0;

  const realTranscriptEntryCount = input.listTranscriptTimelineSegments({
    sessionId,
    includeNoSpeech: false,
    includeFakeStt: false,
  }).length;

  const isTerminal =
    openChunkCount === 0 &&
    sttQueuedCount === 0 &&
    sttProcessingCount === 0 &&
    sttOtherNonTerminalCount === 0;
  const canGenerateDraft = realTranscriptEntryCount > 0;
  const shouldRecordEmptyTimelineBlock =
    isTerminal && realTranscriptEntryCount === 0;
  const canInvokeRunner =
    isTerminal && (canGenerateDraft || shouldRecordEmptyTimelineBlock);

  return {
    sessionId,
    sessionStatus: "finalized",
    openChunkCount,
    sttQueuedCount,
    sttProcessingCount,
    sttDoneCount,
    sttFailedCount,
    sttFailedMissingFileCount,
    sttOtherNonTerminalCount,
    chunksMissingSttJobCount,
    chunksWithTranscodeFailedCount,
    chunksMissingSttAudioCount,
    realTranscriptEntryCount,
    isTerminal,
    canGenerateDraft,
    shouldRecordEmptyTimelineBlock,
    canInvokeRunner,
    warnings: makeAiCleanupSttWarnings({
      sttFailedCount,
      sttFailedMissingFileCount,
      chunksMissingSttJobCount,
      chunksWithTranscodeFailedCount,
      chunksMissingSttAudioCount,
    }),
  };
}

function makeAiCleanupSttWarnings(input: {
  sttFailedCount: number;
  sttFailedMissingFileCount: number;
  chunksMissingSttJobCount: number;
  chunksWithTranscodeFailedCount: number;
  chunksMissingSttAudioCount: number;
}): string[] {
  const warnings: string[] = [];
  if (input.sttFailedCount > 0) {
    warnings.push(formatLocaleText("ko", "runtimeCli.storage.sttFailedCount", {
      count: input.sttFailedCount,
    }));
  }
  if (input.sttFailedMissingFileCount > 0) {
    warnings.push(formatLocaleText("ko", "runtimeCli.storage.sttMissingInputCount", {
      count: input.sttFailedMissingFileCount,
    }));
  }
  if (input.chunksMissingSttJobCount > 0) {
    warnings.push(formatLocaleText("ko", "runtimeCli.storage.chunkMissingSttJobCount", {
      count: input.chunksMissingSttJobCount,
    }));
  }
  if (input.chunksWithTranscodeFailedCount > 0) {
    warnings.push(formatLocaleText("ko", "runtimeCli.storage.chunkTranscodeFailedCount", {
      count: input.chunksWithTranscodeFailedCount,
    }));
  }
  if (input.chunksMissingSttAudioCount > 0) {
    warnings.push(formatLocaleText("ko", "runtimeCli.storage.chunkMissingSttAudioCount", {
      count: input.chunksMissingSttAudioCount,
    }));
  }
  return warnings;
}
