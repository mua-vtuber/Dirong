import type { RecordingRuntimeState, SessionRow } from "./session-store.js";
import { SqlRunner } from "./sql-runner.js";
import { t, type LocaleKey } from "../i18n/catalog.js";
import { resolveAppLocale } from "../i18n/app-locale.js";
import type { DirongLocale } from "../settings/local-settings-store.js";

export type StatusTextReadModelInput = {
  sql: SqlRunner;
  runtime: RecordingRuntimeState;
  dashboardUrl: string;
  locale?: DirongLocale;
  getSession: (sessionId: string) => SessionRow | null;
  getLatestSession: () => SessionRow | null;
};

export function buildStatusTextReadModel(
  input: StatusTextReadModelInput,
): string {
  const locale = resolveAppLocale({ locale: input.locale });
  const session =
    input.runtime.sessionId !== null
      ? input.getSession(input.runtime.sessionId)
      : input.getLatestSession();
  if (!session) {
    return [
      t(locale, "runtimeStatus.recordingStatus.noSession"),
      `${t(locale, "runtimeStatus.recordingStatus.dashboard")}: ${input.dashboardUrl}`,
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
    `${t(locale, "runtimeStatus.recordingStatus.heading")}: ${formatSessionStatus(locale, session.status)}`,
    `${t(locale, "runtimeStatus.recordingStatus.session")}: ${session.id}`,
    `${t(locale, "runtimeStatus.recordingStatus.voiceChannel")}: ${session.voice_channel_name ?? session.voice_channel_id}`,
    `${t(locale, "runtimeStatus.recordingStatus.currentRecording")}: ${input.runtime.isRecording ? t(locale, "runtimeStatus.recordingStatus.yes") : t(locale, "runtimeStatus.recordingStatus.no")}`,
    `${t(locale, "runtimeStatus.recordingStatus.openChunks")}: ${input.runtime.openChunks}`,
    `${t(locale, "runtimeStatus.recordingStatus.speakers")}: ${speakerCount}`,
    `${t(locale, "runtimeStatus.recordingStatus.chunks")}: ${chunkCount}`,
    `${t(locale, "runtimeStatus.recordingStatus.sttQueue")}: ${formatQueueStats(locale, queueStats)}`,
    `${t(locale, "runtimeStatus.recordingStatus.openRepairItems")}: ${openRepairs}`,
    `${t(locale, "runtimeStatus.recordingStatus.dashboard")}: ${input.dashboardUrl}`,
  ].join("\n");
}

function formatQueueStats(
  locale: DirongLocale,
  rows: Array<{ status: string; count: number }>,
): string {
  const counts = new Map(rows.map((row) => [row.status, row.count]));
  return ["queued", "processing", "done", "failed", "failed_missing_file"]
    .map((status) => `${formatSttStatus(locale, status)}(${status}):${counts.get(status) ?? 0}`)
    .join(" / ");
}

function formatSessionStatus(locale: DirongLocale, status: string): string {
  const key = sessionStatusKey(status);
  return `${t(locale, key)} (${status})`;
}

function formatSttStatus(locale: DirongLocale, status: string): string {
  return t(locale, sttStatusKey(status));
}

function sessionStatusKey(status: string): LocaleKey {
  if (status === "created") {
    return "runtimeStatus.recordingStatus.sessionStatus.created";
  }
  if (status === "active") {
    return "runtimeStatus.recordingStatus.sessionStatus.active";
  }
  if (status === "reconnecting") {
    return "runtimeStatus.recordingStatus.sessionStatus.reconnecting";
  }
  if (status === "stopping") {
    return "runtimeStatus.recordingStatus.sessionStatus.stopping";
  }
  if (status === "finalized") {
    return "runtimeStatus.recordingStatus.sessionStatus.finalized";
  }
  if (status === "failed") {
    return "runtimeStatus.recordingStatus.sessionStatus.failed";
  }
  if (status === "needs_repair") {
    return "runtimeStatus.recordingStatus.sessionStatus.needsRepair";
  }
  return "runtimeStatus.recordingStatus.sessionStatus.unknown";
}

function sttStatusKey(status: string): LocaleKey {
  if (status === "queued") {
    return "runtimeStatus.recordingStatus.sttStatus.queued";
  }
  if (status === "processing") {
    return "runtimeStatus.recordingStatus.sttStatus.processing";
  }
  if (status === "done") {
    return "runtimeStatus.recordingStatus.sttStatus.done";
  }
  if (status === "failed") {
    return "runtimeStatus.recordingStatus.sttStatus.failed";
  }
  if (status === "failed_missing_file") {
    return "runtimeStatus.recordingStatus.sttStatus.failedMissingFile";
  }
  return "runtimeStatus.recordingStatus.sttStatus.unknown";
}
