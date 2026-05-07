import type { RecordingRuntimeState, SessionRow } from "./session-store.js";
import { SqlRunner } from "./sql-runner.js";

export type StatusTextReadModelInput = {
  sql: SqlRunner;
  runtime: RecordingRuntimeState;
  dashboardUrl: string;
  getSession: (sessionId: string) => SessionRow | null;
  getLatestSession: () => SessionRow | null;
};

export function buildStatusTextReadModel(
  input: StatusTextReadModelInput,
): string {
  const session =
    input.runtime.sessionId !== null
      ? input.getSession(input.runtime.sessionId)
      : input.getLatestSession();
  if (!session) {
    return [
      "진행 중이거나 최근 생성된 녹음 세션이 없습니다.",
      `Dashboard: ${input.dashboardUrl}`,
    ].join("\n");
  }

  const speakerCount = input.sql.get<{ count: number }>(
    "SELECT COUNT(*) AS count FROM session_speakers WHERE session_id = ? AND is_bot = 0",
    session.id,
  )?.count ?? 0;
  const chunkCount = input.sql.get<{ count: number }>(
    "SELECT COUNT(*) AS count FROM chunks WHERE session_id = ?",
    session.id,
  )?.count ?? 0;
  const queueStats = input.sql.all<{ status: string; count: number }>(
    `SELECT status, COUNT(*) AS count
     FROM stt_jobs
     WHERE session_id = ?
     GROUP BY status
     ORDER BY status ASC`,
    session.id,
  );
  const openRepairs = input.sql.get<{ count: number }>(
    "SELECT COUNT(*) AS count FROM repair_items WHERE status = 'open'",
  )?.count ?? 0;

  return [
    `Recording + STT 상태: ${session.status}`,
    `세션: ${session.id}`,
    `음성 채널: ${session.voice_channel_name ?? session.voice_channel_id}`,
    `현재 녹음: ${input.runtime.isRecording ? "yes" : "no"}`,
    `열려 있는 chunk: ${input.runtime.openChunks}`,
    `speaker: ${speakerCount}명`,
    `chunk: ${chunkCount}개`,
    `STT queue: ${formatQueueStats(queueStats)}`,
    `open repair item: ${openRepairs}개`,
    `Dashboard: ${input.dashboardUrl}`,
  ].join("\n");
}

function formatQueueStats(rows: Array<{ status: string; count: number }>): string {
  const counts = new Map(rows.map((row) => [row.status, row.count]));
  return ["queued", "processing", "done", "failed", "failed_missing_file"]
    .map((status) => `${status}:${counts.get(status) ?? 0}`)
    .join(" / ");
}
