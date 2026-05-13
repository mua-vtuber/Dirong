import { planJobFailureRetry } from "./job-retry-policy.js";
import type {
  ChunkRow,
  SttJobRow,
  TranscriptSegmentRow,
} from "./session-store.js";
import type { SqlRunner } from "./sql-runner.js";

export type SttJobQueueOptions = {
  now(): string;
  toStoredPath(filePath: string | null): string | null;
};

export class SttJobQueue {
  constructor(
    private readonly sql: SqlRunner,
    private readonly options: SttJobQueueOptions,
  ) {}

  upsertForChunk(
    chunk: ChunkRow,
    input: {
      inputAudioPath: string;
      inputAudioSha256: string | null;
      maxAttempts: number;
      now: string;
    },
  ): void {
    const jobId = `stt_${chunk.id}`;
    this.sql.run(
      `INSERT INTO stt_jobs (
        id, session_id, chunk_id, user_id, display_name_snapshot,
        input_audio_path, status, attempts, max_attempts, locked_by,
        locked_until, next_attempt_at, input_audio_sha256,
        result_text_sha256, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, ?, NULL, NULL, ?, ?, NULL, NULL, ?, ?)
      ON CONFLICT(chunk_id) DO UPDATE SET
        input_audio_path = excluded.input_audio_path,
        status = CASE
          WHEN stt_jobs.status = 'failed_missing_file' THEN 'queued'
          ELSE stt_jobs.status
        END,
        input_audio_sha256 = excluded.input_audio_sha256,
        max_attempts = excluded.max_attempts,
        updated_at = excluded.updated_at`,
      jobId,
      chunk.session_id,
      chunk.id,
      chunk.user_id,
      chunk.display_name_snapshot,
      this.options.toStoredPath(input.inputAudioPath),
      input.maxAttempts,
      input.now,
      input.inputAudioSha256,
      input.now,
      input.now,
    );
  }

  listNonTerminalWithInputAudio(): SttJobRow[] {
    return this.sql.all<SttJobRow>(
      `SELECT *
       FROM stt_jobs
       WHERE status NOT IN ('done', 'failed_missing_file')
         AND input_audio_path IS NOT NULL`,
    );
  }

  markMissingAudio(jobId: string, now = this.options.now()): void {
    this.sql.run(
      `UPDATE stt_jobs
       SET status = 'failed_missing_file', locked_by = NULL,
           locked_until = NULL, last_error = ?, updated_at = ?
       WHERE id = ?`,
      "STT input audio file이 없습니다.",
      now,
      jobId,
    );
  }

  listExpiredProcessingLeases(nowIso: string): SttJobRow[] {
    return this.sql.all<SttJobRow>(
      `SELECT *
       FROM stt_jobs
       WHERE status = 'processing'
         AND locked_until IS NOT NULL
         AND locked_until < ?
         AND attempts < max_attempts`,
      nowIso,
    );
  }

  requeueExpiredProcessingLease(jobId: string, nowIso: string): void {
    this.sql.run(
      `UPDATE stt_jobs
       SET status = 'queued', locked_by = NULL, locked_until = NULL,
           next_attempt_at = ?, updated_at = ?
       WHERE id = ?`,
      nowIso,
      nowIso,
      jobId,
    );
  }

  claimNext(input: {
    workerId: string;
    leaseMs: number;
    sessionId?: string | null;
  }): SttJobRow | null {
    const now = this.options.now();
    const lockedUntil = new Date(Date.now() + input.leaseMs).toISOString();
    let claimed: SttJobRow | null = null;

    this.sql.transaction(() => {
      const job = input.sessionId
        ? this.sql.get<SttJobRow>(
            `SELECT *
             FROM stt_jobs
             WHERE status = 'queued'
               AND next_attempt_at <= ?
               AND session_id = ?
             ORDER BY created_at ASC
             LIMIT 1`,
            now,
            input.sessionId,
          )
        : this.sql.get<SttJobRow>(
            `SELECT *
             FROM stt_jobs
             WHERE status = 'queued'
               AND next_attempt_at <= ?
             ORDER BY created_at ASC
             LIMIT 1`,
            now,
          );

      if (!job) {
        return;
      }

      const changes = this.sql.run(
        `UPDATE stt_jobs
         SET status = 'processing',
             attempts = attempts + 1,
             locked_by = ?,
             locked_until = ?,
             last_error = NULL,
             updated_at = ?
         WHERE id = ?
           AND status = 'queued'`,
        input.workerId,
        lockedUntil,
        now,
        job.id,
      );

      if (changes === 0) {
        return;
      }

      claimed = this.get(job.id);
    });

    return claimed;
  }

  listQueued(input: {
    limit: number;
    sessionId?: string | null;
  }): SttJobRow[] {
    const now = this.options.now();
    return input.sessionId
      ? this.sql.all<SttJobRow>(
          `SELECT *
           FROM stt_jobs
           WHERE status = 'queued'
             AND next_attempt_at <= ?
             AND session_id = ?
           ORDER BY created_at ASC
           LIMIT ?`,
          now,
          input.sessionId,
          input.limit,
        )
      : this.sql.all<SttJobRow>(
          `SELECT *
           FROM stt_jobs
           WHERE status = 'queued'
             AND next_attempt_at <= ?
           ORDER BY created_at ASC
           LIMIT ?`,
          now,
          input.limit,
        );
  }

  markDone(input: {
    job: SttJobRow;
    inputAudioSha256?: string | null;
    resultHash: string;
    now: string;
  }): void {
    this.sql.run(
      `UPDATE stt_jobs
       SET status = 'done',
           locked_by = NULL,
           locked_until = NULL,
           input_audio_sha256 = COALESCE(?, input_audio_sha256),
           result_text_sha256 = ?,
           last_error = NULL,
           updated_at = ?
       WHERE id = ?`,
      input.inputAudioSha256 ?? null,
      input.resultHash,
      input.now,
      input.job.id,
    );
  }

  failProcessing(input: { jobId: string; error: string }): void {
    const job = this.get(input.jobId);
    if (!job) {
      return;
    }

    const now = this.options.now();
    const retryPlan = planJobFailureRetry({
      attempts: job.attempts,
      maxAttempts: job.max_attempts,
      now,
    });

    this.sql.run(
      `UPDATE stt_jobs
       SET status = ?,
           locked_by = NULL,
           locked_until = NULL,
           next_attempt_at = ?,
           last_error = ?,
           updated_at = ?
       WHERE id = ?`,
      retryPlan.status,
      retryPlan.nextAttemptAt,
      input.error,
      now,
      input.jobId,
    );
  }

  get(jobId: string): SttJobRow | null {
    return this.sql.get<SttJobRow>("SELECT * FROM stt_jobs WHERE id = ?", jobId);
  }

  getTranscriptSegment(sttJobId: string): TranscriptSegmentRow | null {
    return this.sql.get<TranscriptSegmentRow>(
      "SELECT * FROM transcript_segments WHERE stt_job_id = ?",
      sttJobId,
    );
  }
}
