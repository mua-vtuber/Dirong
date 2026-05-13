import path from "node:path";
import { redactForJson } from "../errors.js";
import type { ChunkRow } from "./rows.js";
import type { SqlRunner } from "./sql-runner.js";

export type ChunkRepositoryOptions = {
  now(): string;
  resolveStoredPath(filePath: string | null): string | null;
  toStoredPath(filePath: string | null): string | null;
};

export class ChunkRepository {
  constructor(
    private readonly sql: SqlRunner,
    private readonly options: ChunkRepositoryOptions,
  ) {}

  upsertSpeaker(input: {
    sessionId: string;
    userId: string;
    displayNameSnapshot: string;
    isBot: boolean;
    seenAtMs: number;
  }): void {
    const now = this.options.now();
    this.sql.run(
      `INSERT INTO session_speakers (
        session_id, user_id, display_name_snapshot, is_bot,
        first_seen_at_ms, first_seen_at, last_seen_at_ms, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, user_id) DO UPDATE SET
        display_name_snapshot = excluded.display_name_snapshot,
        is_bot = excluded.is_bot,
        last_seen_at_ms = excluded.last_seen_at_ms,
        last_seen_at = excluded.last_seen_at`,
      input.sessionId,
      input.userId,
      input.displayNameSnapshot,
      input.isBot ? 1 : 0,
      input.seenAtMs,
      now,
      input.seenAtMs,
      now,
    );
  }

  createWriting(input: {
    chunkId: string;
    sessionId: string;
    chunkIndex: number;
    userId: string;
    displayNameSnapshot: string;
    startedAtMs: number;
    rawAudioPath: string;
  }): void {
    const now = this.options.now();
    this.sql.run(
      `INSERT INTO chunks (
        id, session_id, chunk_index, user_id, display_name_snapshot,
        status, started_at_ms, raw_audio_path, raw_audio_format,
        transcode_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'writing', ?, ?, 'ogg-opus', 'pending', ?, ?)`,
      input.chunkId,
      input.sessionId,
      input.chunkIndex,
      input.userId,
      input.displayNameSnapshot,
      input.startedAtMs,
      this.options.toStoredPath(input.rawAudioPath),
      now,
      now,
    );
  }

  finalizeRaw(input: {
    chunkId: string;
    endedAtMs: number;
    durationMs: number;
    rawByteSize: number;
    rawSha256: string | null;
    closeReason: string;
    pipelineError: unknown;
  }): void {
    this.sql.transaction(() => {
      this.sql.run(
        `UPDATE chunks
         SET status = 'finalized', ended_at_ms = ?, duration_ms = ?,
             raw_byte_size = ?, raw_sha256 = ?, close_reason = ?,
             pipeline_error_json = ?, updated_at = ?
         WHERE id = ?`,
        input.endedAtMs,
        input.durationMs,
        input.rawByteSize,
        input.rawSha256,
        input.closeReason,
        input.pipelineError === null
          ? null
          : JSON.stringify(redactForJson(input.pipelineError)),
        this.options.now(),
        input.chunkId,
      );
      this.sql.run(
        `UPDATE session_speakers
         SET chunk_count = chunk_count + 1, last_seen_at_ms = ?, last_seen_at = ?
         WHERE session_id = (SELECT session_id FROM chunks WHERE id = ?)
           AND user_id = (SELECT user_id FROM chunks WHERE id = ?)`,
        input.endedAtMs,
        this.options.now(),
        input.chunkId,
        input.chunkId,
      );
    });
  }

  markTranscodedAndQueued(input: {
    chunkId: string;
    sttAudioPath: string;
    sttAudioFormat: string;
    sttByteSize: number;
    sttSha256: string | null;
    now: string;
  }): void {
    this.sql.run(
      `UPDATE chunks
       SET status = 'queued', stt_audio_path = ?, stt_audio_format = ?,
           stt_byte_size = ?, stt_sha256 = ?, transcode_status = 'done',
           transcode_error = NULL, updated_at = ?
       WHERE id = ?`,
      this.options.toStoredPath(input.sttAudioPath),
      input.sttAudioFormat,
      input.sttByteSize,
      input.sttSha256,
      input.now,
      input.chunkId,
    );
  }

  markExistingSttQueued(chunkId: string, now: string): void {
    this.sql.run(
      `UPDATE chunks
       SET status = 'queued', transcode_status = 'done', updated_at = ?
       WHERE id = ?`,
      now,
      chunkId,
    );
  }

  markTranscodeFailed(input: { chunkId: string; error: string }): void {
    this.sql.run(
      `UPDATE chunks
       SET status = 'transcode_failed', transcode_status = 'failed',
           transcode_error = ?, updated_at = ?
       WHERE id = ?`,
      input.error,
      this.options.now(),
      input.chunkId,
    );
  }

  markFailed(input: { chunkId: string; error: unknown }): void {
    this.sql.run(
      `UPDATE chunks
       SET status = 'failed', pipeline_error_json = ?, updated_at = ?
       WHERE id = ?`,
      JSON.stringify(redactForJson(input.error)),
      this.options.now(),
      input.chunkId,
    );
  }

  get(chunkId: string): ChunkRow | null {
    return this.sql.get<ChunkRow>("SELECT * FROM chunks WHERE id = ?", chunkId);
  }

  listMissingSttJob(): ChunkRow[] {
    return this.sql.all<ChunkRow>(
      `SELECT c.*
       FROM chunks c
       LEFT JOIN stt_jobs j ON j.chunk_id = c.id
       WHERE j.id IS NULL
         AND c.status IN ('finalized', 'queued', 'transcode_failed')
       ORDER BY c.created_at ASC`,
    );
  }

  listWriting(): ChunkRow[] {
    return this.sql.all<ChunkRow>(
      `SELECT *
       FROM chunks
       WHERE status = 'writing'
       ORDER BY created_at ASC`,
    );
  }

  hasAudioPath(filePath: string): boolean {
    const candidates = uniqueStrings([
      filePath,
      path.resolve(filePath),
      this.options.toStoredPath(filePath),
      this.options.resolveStoredPath(filePath),
    ]);
    const placeholders = candidates.map(() => "?").join(", ");
    const row = this.sql.get<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM chunks
       WHERE raw_audio_path IN (${placeholders})
          OR stt_audio_path IN (${placeholders})`,
      ...candidates,
      ...candidates,
    );
    return (row?.count ?? 0) > 0;
  }
}

function uniqueStrings(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}
