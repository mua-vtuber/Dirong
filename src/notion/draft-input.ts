import type { MeetingNotesDraftV1 } from "../ai/cleanup/draft.js";
import type { MeetingNotesDraftRow, SessionRow } from "../storage/session-store.js";

export type NotionDraftSpeaker = {
  user_id: string;
  display_name_snapshot: string;
  is_bot: number;
  first_seen_at_ms: number;
  last_seen_at_ms: number;
  chunk_count: number;
};

export type NotionDraftInput = {
  session: Pick<
    SessionRow,
    "id" | "started_at" | "finalized_at" | "voice_channel_id" | "voice_channel_name"
  >;
  draft: Pick<
    MeetingNotesDraftRow,
    | "id"
    | "session_id"
    | "provider"
    | "model"
    | "prompt_version"
    | "output_hash"
    | "validation_status"
  >;
  draftContent: MeetingNotesDraftV1;
  speakers: NotionDraftSpeaker[];
};
