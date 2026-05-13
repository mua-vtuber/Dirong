import type { MeetingNotesDraftRow } from "./rows.js";
import type { SqlRunner } from "./sql-runner.js";

export type MeetingNotesDraftRepositoryOptions = {
  toStoredPath(filePath: string | null): string | null;
};

export class MeetingNotesDraftRepository {
  constructor(
    private readonly sql: SqlRunner,
    private readonly options: MeetingNotesDraftRepositoryOptions,
  ) {}

  insertValid(input: {
    id: string;
    sessionId: string;
    aiCleanupJobId: string;
    schemaVersion: string;
    language: string;
    title: string;
    summaryText: string;
    draftJson: string;
    markdown: string;
    jsonPath: string;
    markdownPath: string;
    rawOutputPath: string;
    provider: string;
    model: string;
    promptVersion: string;
    inputHash: string;
    outputHash: string;
    now: string;
  }): void {
    this.sql.run(
      `INSERT INTO meeting_notes_drafts (
        id, session_id, ai_cleanup_job_id, schema_version, language,
        title, summary_text, draft_json, markdown, json_path,
        markdown_path, raw_output_path, provider, model, prompt_version,
        input_hash, output_hash, validation_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'valid', ?, ?)`,
      input.id,
      input.sessionId,
      input.aiCleanupJobId,
      input.schemaVersion,
      input.language,
      input.title,
      input.summaryText,
      input.draftJson,
      input.markdown,
      this.options.toStoredPath(input.jsonPath),
      this.options.toStoredPath(input.markdownPath),
      this.options.toStoredPath(input.rawOutputPath),
      input.provider,
      input.model,
      input.promptVersion,
      input.inputHash,
      input.outputHash,
      input.now,
      input.now,
    );
  }

  getLatestBySession(sessionId: string): MeetingNotesDraftRow | null {
    return this.sql.get<MeetingNotesDraftRow>(
      `SELECT *
       FROM meeting_notes_drafts
       WHERE session_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      sessionId,
    );
  }

  getByJobId(jobId: string): MeetingNotesDraftRow | null {
    return this.sql.get<MeetingNotesDraftRow>(
      "SELECT * FROM meeting_notes_drafts WHERE ai_cleanup_job_id = ?",
      jobId,
    );
  }
}
