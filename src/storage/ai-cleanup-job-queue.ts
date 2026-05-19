import { planJobFailureRetry } from "./job-retry-policy.js";
import { t } from "../i18n/catalog.js";
import type {
  AiCleanupFailureKind,
  AiCleanupJobRow,
  AiCleanupLeaseRepairSummary,
} from "./rows.js";
import type { SqlRunner } from "./sql-runner.js";

export type AiCleanupJobQueueOptions = {
  now(): string;
  toStoredPath(filePath: string | null): string | null;
};

export class AiCleanupJobQueue {
  constructor(
    private readonly sql: SqlRunner,
    private readonly options: AiCleanupJobQueueOptions,
  ) {}

  getOrCreate(input: {
    id: string;
    sessionId: string;
    provider: string;
    model: string;
    command: string | null;
    promptVersion: string;
    inputContractVersion: string;
    inputHash: string;
    inputEntryCount: number;
    inputTimelineJsonPath: string | null;
    inputTimelineMarkdownPath: string | null;
    maxAttempts: number;
  }): AiCleanupJobRow {
    const now = this.options.now();
    this.sql.run(
      `INSERT INTO ai_cleanup_jobs (
        id, session_id, status, attempts, max_attempts, locked_by,
        locked_until, next_attempt_at, provider, model, command,
        prompt_version, input_contract_version, input_hash,
        input_entry_count, input_timeline_json_path,
        input_timeline_markdown_path, created_at, updated_at
      ) VALUES (?, ?, 'queued', 0, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, provider, model, prompt_version, input_hash)
      DO UPDATE SET
        command = excluded.command,
        input_entry_count = excluded.input_entry_count,
        input_timeline_json_path = COALESCE(excluded.input_timeline_json_path, ai_cleanup_jobs.input_timeline_json_path),
        input_timeline_markdown_path = COALESCE(excluded.input_timeline_markdown_path, ai_cleanup_jobs.input_timeline_markdown_path),
        max_attempts = CASE
          WHEN ai_cleanup_jobs.status IN ('queued', 'blocked', 'failed') THEN excluded.max_attempts
          ELSE ai_cleanup_jobs.max_attempts
        END,
        updated_at = excluded.updated_at`,
      input.id,
      input.sessionId,
      input.maxAttempts,
      now,
      input.provider,
      input.model,
      input.command,
      input.promptVersion,
      input.inputContractVersion,
      input.inputHash,
      input.inputEntryCount,
      this.options.toStoredPath(input.inputTimelineJsonPath),
      this.options.toStoredPath(input.inputTimelineMarkdownPath),
      now,
      now,
    );

    const job = this.getByIdentity({
      sessionId: input.sessionId,
      provider: input.provider,
      model: input.model,
      promptVersion: input.promptVersion,
      inputHash: input.inputHash,
    });
    if (!job) {
      throw new Error(t("ko", "runtimeCli.storage.aiCleanupJobSaveFailed"));
    }
    return job;
  }

  get(jobId: string): AiCleanupJobRow | null {
    return this.sql.get<AiCleanupJobRow>(
      "SELECT * FROM ai_cleanup_jobs WHERE id = ?",
      jobId,
    );
  }

  getByIdentity(input: {
    sessionId: string;
    provider: string;
    model: string;
    promptVersion: string;
    inputHash: string;
  }): AiCleanupJobRow | null {
    return this.sql.get<AiCleanupJobRow>(
      `SELECT *
       FROM ai_cleanup_jobs
       WHERE session_id = ?
         AND provider = ?
         AND model = ?
         AND prompt_version = ?
         AND input_hash = ?`,
      input.sessionId,
      input.provider,
      input.model,
      input.promptVersion,
      input.inputHash,
    );
  }

  claim(input: {
    jobId: string;
    workerId: string;
    leaseMs: number;
  }): AiCleanupJobRow | null {
    const now = this.options.now();
    const lockedUntil = new Date(Date.now() + input.leaseMs).toISOString();
    let claimed: AiCleanupJobRow | null = null;

    this.sql.transaction(() => {
      const changes = this.sql.run(
        `UPDATE ai_cleanup_jobs
         SET status = 'processing',
             attempts = attempts + 1,
             locked_by = ?,
             locked_until = ?,
             failure_kind = NULL,
             last_error = NULL,
             updated_at = ?
         WHERE id = ?
           AND status = 'queued'
           AND next_attempt_at <= ?`,
        input.workerId,
        lockedUntil,
        now,
        input.jobId,
        now,
      );

      if (changes === 0) {
        return;
      }

      claimed = this.get(input.jobId);
    });

    return claimed;
  }

  updateArtifacts(input: {
    jobId: string;
    command?: string | null;
    promptPath?: string | null;
    rawOutputPath?: string | null;
    stderrPath?: string | null;
    parsedJsonPath?: string | null;
    markdownPath?: string | null;
    outputHash?: string | null;
  }): void {
    this.sql.run(
      `UPDATE ai_cleanup_jobs
       SET command = COALESCE(?, command),
           prompt_path = COALESCE(?, prompt_path),
           raw_output_path = COALESCE(?, raw_output_path),
           stderr_path = COALESCE(?, stderr_path),
           parsed_json_path = COALESCE(?, parsed_json_path),
           markdown_path = COALESCE(?, markdown_path),
           output_hash = COALESCE(?, output_hash),
           updated_at = ?
       WHERE id = ?`,
      input.command ?? null,
      this.options.toStoredPath(input.promptPath ?? null),
      this.options.toStoredPath(input.rawOutputPath ?? null),
      this.options.toStoredPath(input.stderrPath ?? null),
      this.options.toStoredPath(input.parsedJsonPath ?? null),
      this.options.toStoredPath(input.markdownPath ?? null),
      input.outputHash ?? null,
      this.options.now(),
      input.jobId,
    );
  }

  block(input: {
    jobId: string;
    failureKind: AiCleanupFailureKind;
    error: string;
  }): void {
    this.sql.run(
      `UPDATE ai_cleanup_jobs
       SET status = 'blocked',
           locked_by = NULL,
           locked_until = NULL,
           failure_kind = ?,
           last_error = ?,
           updated_at = ?
       WHERE id = ?`,
      input.failureKind,
      input.error,
      this.options.now(),
      input.jobId,
    );
  }

  failProcessing(input: {
    jobId: string;
    failureKind: AiCleanupFailureKind;
    error: string;
  }): void {
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
      `UPDATE ai_cleanup_jobs
       SET status = ?,
           locked_by = NULL,
           locked_until = NULL,
           next_attempt_at = ?,
           failure_kind = ?,
           last_error = ?,
           updated_at = ?
       WHERE id = ?`,
      retryPlan.status,
      retryPlan.nextAttemptAt,
      input.failureKind,
      input.error,
      now,
      input.jobId,
    );
  }

  retryFailed(input: {
    jobId: string;
    nowIso: string;
    maxAttempts: number;
  }): AiCleanupJobRow | null {
    const job = this.get(input.jobId);
    if (!job || job.status !== "failed") {
      return null;
    }
    this.sql.run(
      `UPDATE ai_cleanup_jobs
       SET status = 'queued',
           attempts = 0,
           max_attempts = ?,
           locked_by = NULL,
           locked_until = NULL,
           next_attempt_at = ?,
           failure_kind = NULL,
           last_error = NULL,
           updated_at = ?
       WHERE id = ?
         AND status = 'failed'`,
      Math.max(1, input.maxAttempts),
      input.nowIso,
      input.nowIso,
      input.jobId,
    );
    return this.get(input.jobId);
  }

  markDone(input: {
    jobId: string;
    jsonPath: string;
    markdownPath: string;
    rawOutputPath: string;
    outputHash: string;
    now: string;
  }): void {
    this.sql.run(
      `UPDATE ai_cleanup_jobs
       SET status = 'done',
           locked_by = NULL,
           locked_until = NULL,
           parsed_json_path = ?,
           markdown_path = ?,
           raw_output_path = ?,
           output_hash = ?,
           failure_kind = NULL,
           last_error = NULL,
           updated_at = ?
       WHERE id = ?`,
      this.options.toStoredPath(input.jsonPath),
      this.options.toStoredPath(input.markdownPath),
      this.options.toStoredPath(input.rawOutputPath),
      input.outputHash,
      input.now,
      input.jobId,
    );
  }

  releaseExpiredLeases(nowIso: string): number {
    const jobs = this.sql.all<AiCleanupJobRow>(
      `SELECT *
       FROM ai_cleanup_jobs
       WHERE status = 'processing'
         AND locked_until IS NOT NULL
         AND locked_until < ?
         AND attempts < max_attempts`,
      nowIso,
    );

    for (const job of jobs) {
      this.sql.run(
        `UPDATE ai_cleanup_jobs
         SET status = 'queued',
             locked_by = NULL,
             locked_until = NULL,
             next_attempt_at = ?,
             updated_at = ?
         WHERE id = ?`,
        nowIso,
        nowIso,
        job.id,
      );
    }

    return jobs.length;
  }

  repairExpiredProcessingJobs(nowIso: string): AiCleanupLeaseRepairSummary {
    const jobs = this.sql.all<AiCleanupJobRow>(
      `SELECT *
       FROM ai_cleanup_jobs
       WHERE status = 'processing'
         AND locked_until IS NOT NULL
         AND locked_until < ?`,
      nowIso,
    );
    let requeued = 0;
    let failed = 0;

    for (const job of jobs) {
      if (job.attempts < job.max_attempts) {
        this.sql.run(
          `UPDATE ai_cleanup_jobs
           SET status = 'queued',
               locked_by = NULL,
               locked_until = NULL,
               next_attempt_at = ?,
               last_error = ?,
               updated_at = ?
           WHERE id = ?`,
          nowIso,
          "AI cleanup processing lease expired; retrying.",
          nowIso,
          job.id,
        );
        requeued += 1;
        continue;
      }

      this.sql.run(
        `UPDATE ai_cleanup_jobs
         SET status = 'failed',
             locked_by = NULL,
             locked_until = NULL,
             next_attempt_at = ?,
             failure_kind = 'provider_timeout',
             last_error = ?,
             updated_at = ?
         WHERE id = ?`,
        nowIso,
        "AI cleanup processing lease expired after max attempts.",
        nowIso,
        job.id,
      );
      failed += 1;
    }

    return { requeued, failed };
  }

  listRecent(sessionId: string | null, limit: number): AiCleanupJobRow[] {
    return sessionId === null
      ? this.sql.all<AiCleanupJobRow>(
          `SELECT *
           FROM ai_cleanup_jobs
           ORDER BY created_at DESC
           LIMIT ?`,
          limit,
        )
      : this.sql.all<AiCleanupJobRow>(
          `SELECT *
           FROM ai_cleanup_jobs
           WHERE session_id = ?
           ORDER BY created_at DESC
           LIMIT ?`,
          sessionId,
          limit,
        );
  }
}
