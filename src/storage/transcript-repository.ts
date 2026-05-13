import type { SpeechStatus, TranscriptSegmentRow } from "./rows.js";
import type { SqlRunner } from "./sql-runner.js";
import type { SqlValue } from "./sqlite.js";

export class TranscriptRepository {
  constructor(private readonly sql: SqlRunner) {}

  upsertSegmentForSttJob(input: {
    id: string;
    sessionId: string;
    chunkId: string;
    sttJobId: string;
    userId: string;
    displayNameSnapshot: string;
    startMs: number;
    endMs: number;
    text: string;
    speechStatus: SpeechStatus;
    source: string;
    provider: string;
    model: string;
    inputAudioSha256: string | null;
    now: string;
  }): void {
    this.sql.run(
      `INSERT INTO transcript_segments (
        id, session_id, chunk_id, stt_job_id, user_id,
        display_name_snapshot, start_ms, end_ms, text, speech_status,
        source, provider, model, input_audio_sha256,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(stt_job_id) DO UPDATE SET
        text = excluded.text,
        speech_status = excluded.speech_status,
        source = excluded.source,
        provider = excluded.provider,
        model = excluded.model,
        input_audio_sha256 = excluded.input_audio_sha256,
        updated_at = excluded.updated_at`,
      input.id,
      input.sessionId,
      input.chunkId,
      input.sttJobId,
      input.userId,
      input.displayNameSnapshot,
      input.startMs,
      input.endMs,
      input.text,
      input.speechStatus,
      input.source,
      input.provider,
      input.model,
      input.inputAudioSha256,
      input.now,
      input.now,
    );
  }

  getBySttJobId(sttJobId: string): TranscriptSegmentRow | null {
    return this.sql.get<TranscriptSegmentRow>(
      "SELECT * FROM transcript_segments WHERE stt_job_id = ?",
      sttJobId,
    );
  }

  listRecent(
    sessionId: string | null,
    limit: number,
  ): TranscriptSegmentRow[] {
    return sessionId === null
      ? this.sql.all<TranscriptSegmentRow>(
          `SELECT *
           FROM transcript_segments
           ORDER BY created_at DESC
           LIMIT ?`,
          limit,
        )
      : this.sql.all<TranscriptSegmentRow>(
          `SELECT *
           FROM transcript_segments
           WHERE session_id = ?
           ORDER BY start_ms DESC
           LIMIT ?`,
          sessionId,
          limit,
        );
  }

  listTimeline(input: {
    sessionId: string;
    includeNoSpeech?: boolean;
    includeFakeStt?: boolean;
  }): TranscriptSegmentRow[] {
    const conditions = ["session_id = ?"];
    const params: SqlValue[] = [input.sessionId];

    if (!input.includeNoSpeech) {
      conditions.push("speech_status = 'speech'");
      conditions.push("length(trim(text)) > 0");
    }

    if (!input.includeFakeStt) {
      conditions.push("source <> 'fake'");
      conditions.push("provider <> 'dirong-fake-stt'");
    }

    return this.sql.all<TranscriptSegmentRow>(
      `SELECT *
       FROM transcript_segments
       WHERE ${conditions.join(" AND ")}
       ORDER BY start_ms ASC, end_ms ASC, created_at ASC`,
      ...params,
    );
  }

  listRecentTextForSpeaker(input: {
    sessionId: string;
    userId: string;
    beforeStartMs: number;
    limit: number;
    sources?: string[];
  }): string[] {
    const sources = input.sources?.filter((source) => source.trim().length > 0) ?? [];
    if (sources.length === 0) {
      return this.sql.all<{ text: string }>(
        `SELECT text
         FROM transcript_segments
         WHERE session_id = ?
           AND user_id = ?
           AND start_ms < ?
           AND speech_status = 'speech'
           AND length(trim(text)) > 0
         ORDER BY start_ms DESC
         LIMIT ?`,
        input.sessionId,
        input.userId,
        input.beforeStartMs,
        input.limit,
      ).map((row) => row.text).reverse();
    }

    const placeholders = sources.map(() => "?").join(", ");
    return this.sql.all<{ text: string }>(
      `SELECT text
       FROM transcript_segments
       WHERE session_id = ?
         AND user_id = ?
         AND start_ms < ?
         AND speech_status = 'speech'
         AND length(trim(text)) > 0
         AND source IN (${placeholders})
       ORDER BY start_ms DESC
       LIMIT ?`,
      input.sessionId,
      input.userId,
      input.beforeStartMs,
      ...sources,
      input.limit,
    ).map((row) => row.text).reverse();
  }
}
