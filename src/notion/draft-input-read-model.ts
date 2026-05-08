import type { MeetingNotesDraftV1 } from "../ai/cleanup/draft.js";
import { SqlRunner } from "../storage/sql-runner.js";
import type {
  MeetingNotesDraftRow,
  SessionRow,
  TranscriptSegmentRow,
} from "../storage/session-store.js";
import type { NotionDraftInput, NotionDraftSpeaker } from "./draft-input.js";

export type NotionDraftCandidateRow = {
  id: string;
  session_id: string;
  created_at: string;
  updated_at: string;
};

export class NotionDraftInputReadModel {
  constructor(private readonly runner: SqlRunner) {}

  loadByDraftId(draftId: string): NotionDraftInput | null {
    const draft = this.runner.get<MeetingNotesDraftRow>(
      "SELECT * FROM meeting_notes_drafts WHERE id = ?",
      draftId,
    );
    if (draft && draft.validation_status !== "valid") {
      return null;
    }
    return draft ? this.loadFromDraft(draft) : null;
  }

  loadLatestValidForSession(sessionId: string): NotionDraftInput | null {
    const draft = this.runner.get<MeetingNotesDraftRow>(
      `SELECT *
       FROM meeting_notes_drafts
       WHERE session_id = ? AND validation_status = 'valid'
       ORDER BY created_at DESC
       LIMIT 1`,
      sessionId,
    );
    return draft ? this.loadFromDraft(draft) : null;
  }

  listLatestValidDraftsMissingDoneWrite(input: {
    targetId: string;
    limit: number;
  }): NotionDraftCandidateRow[] {
    return this.runner.all<NotionDraftCandidateRow>(
      `SELECT d.id, d.session_id, d.created_at, d.updated_at
       FROM meeting_notes_drafts d
       INNER JOIN ai_cleanup_jobs j
         ON j.id = d.ai_cleanup_job_id
        AND j.status = 'done'
       WHERE d.validation_status = 'valid'
         AND NOT EXISTS (
           SELECT 1
           FROM notion_writes w
           WHERE w.draft_id = d.id
             AND w.target_type = 'data_source'
             AND w.target_id = ?
             AND w.status = 'done'
         )
       ORDER BY d.created_at DESC, d.id DESC
       LIMIT ?`,
      input.targetId,
      input.limit,
    );
  }

  private loadFromDraft(draft: MeetingNotesDraftRow): NotionDraftInput | null {
    const session = this.runner.get<SessionRow>(
      "SELECT * FROM sessions WHERE id = ?",
      draft.session_id,
    );
    if (!session) {
      return null;
    }

    const parsed = JSON.parse(draft.draft_json) as MeetingNotesDraftV1;
    return {
      session,
      draft,
      draftContent: parsed as MeetingNotesDraftV1,
      speakers: this.runner.all<NotionDraftSpeaker>(
        `SELECT
           user_id,
           display_name_snapshot,
           is_bot,
           first_seen_at_ms,
           last_seen_at_ms,
           chunk_count
         FROM session_speakers
         WHERE session_id = ?
         ORDER BY first_seen_at_ms ASC, user_id ASC`,
        session.id,
      ),
      timelineEntries: this.runner.all<TranscriptSegmentRow>(
        `SELECT *
         FROM transcript_segments
         WHERE session_id = ?
           AND speech_status = 'speech'
           AND length(trim(text)) > 0
           AND source <> 'fake'
           AND provider <> 'dirong-fake-stt'
         ORDER BY start_ms ASC, end_ms ASC, created_at ASC`,
        session.id,
      ),
    };
  }
}
