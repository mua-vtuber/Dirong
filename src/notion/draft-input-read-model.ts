import type { MeetingNotesDraftV1 } from "../ai/cleanup/draft.js";
import { SqlRunner } from "../storage/sql-runner.js";
import type { MeetingNotesDraftRow, SessionRow } from "../storage/session-store.js";
import type { NotionDraftInput, NotionDraftSpeaker } from "./draft-input.js";

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
    };
  }
}
