import { MEETING_NOTES_DRAFT_SCHEMA_VERSION } from "../ai/cleanup/draft.js";
import type { MeetingNotesDraftV1 } from "../ai/cleanup/draft.js";
import type { DirongLocale } from "../settings/local-settings-store.js";
import type { NotionDraftInput, NotionDraftSpeaker } from "./draft-input.js";
import type { TranscriptSegmentRow } from "../storage/session-store.js";
import { DEFAULT_PROJECT_ID } from "../projects/project-types.js";

type SpeakerFixture = [name: string, isBot: number];

export type MakeNotionDraftInputOptions = {
  title?: string;
  summary?: string;
  voiceChannelName?: string | null;
  speakers?: SpeakerFixture[];
  timelineEntries?: TranscriptSegmentRow[];
  emptyDraftArrays?: boolean;
  actionItems?: MeetingNotesDraftV1["actionItems"];
  notionProperties?: MeetingNotesDraftV1["notionProperties"];
  locale?: DirongLocale;
  projectId?: string | null;
};

export function makeNotionDraftInput(
  options: MakeNotionDraftInputOptions = {},
): NotionDraftInput {
  const draftContent = makeDraftContent(options);
  return {
    session: {
      id: "session-1",
      project_id: "projectId" in options
        ? options.projectId ?? null
        : DEFAULT_PROJECT_ID,
      started_at: "2026-05-07T19:00:00+09:00",
      finalized_at: "2026-05-07T20:12:00+09:00",
      voice_channel_id: "voice-1",
      voice_channel_name:
        options.voiceChannelName === undefined ? "회의방" : options.voiceChannelName,
    },
    draft: {
      id: "draft-1",
      session_id: "session-1",
      provider: "claude-cli",
      model: "test-model",
      prompt_version: "phase4-v1",
      output_hash: "draft-output-hash",
      validation_status: "valid",
    },
    draftContent,
    speakers: makeSpeakers(
      options.speakers ?? [
        ["Taniar", 0],
        ["Ari", 0],
        ["Dirong Bot", 1],
      ],
    ),
    timelineEntries: options.timelineEntries ?? makeTimelineEntries(),
  };
}

function makeDraftContent(
  options: MakeNotionDraftInputOptions,
): MeetingNotesDraftV1 {
  const reference = {
    chunkId: "chunk-1",
    sttJobId: "stt-1",
    startMs: 0,
    endMs: 60000,
    speaker: "Taniar",
  };

  return {
    schemaVersion: MEETING_NOTES_DRAFT_SCHEMA_VERSION,
    language: options.locale ?? "ko",
    sessionId: "session-1",
    sourceTimeline: {
      contractVersion: "phase3.5-transcript-timeline-v1",
      inputHash: "input-hash",
      entryCount: 1,
    },
    meetingTitle: {
      text: options.title ?? "주간 회의",
      confidence: "high",
      references: [reference],
    },
    summary: {
      text: options.summary ?? "이번 주 진행 상황을 공유했습니다.",
      references: [reference],
    },
    topics: options.emptyDraftArrays
      ? []
      : [
          {
            id: "topic-1",
            title: "진행 상황",
            summary: "Phase 5 준비 상태를 확인했습니다.",
            references: [reference],
          },
        ],
    decisions: options.emptyDraftArrays
      ? []
      : [
          {
            id: "decision-1",
            title: "Notion MVP",
            detail: "수동 업로드부터 구현합니다.",
            status: "decided",
            references: [reference],
          },
        ],
    actionItems: options.actionItems ?? (options.emptyDraftArrays
      ? []
      : [
          {
            id: "action-1",
            task: "Notion writer 테스트를 추가한다.",
            owner: {
              status: "explicit",
              name: "Taniar",
              userId: "user-1",
              evidence: [reference],
            },
            dueDate: {
              status: "unspecified",
              rawText: null,
              isoDate: null,
              evidence: [],
            },
            references: [reference],
          },
        ]),
    unresolvedItems: options.emptyDraftArrays
      ? []
      : [
          {
            id: "unresolved-1",
            text: "자동 업로드 시점은 추가 검토가 필요합니다.",
            reason: "사용자 검토 전 공개 위험",
            references: [reference],
          },
        ],
    uncertaintyNotes: options.emptyDraftArrays
      ? []
      : [
          {
            id: "uncertainty-1",
            text: "일부 발화자가 겹쳐 들렸습니다.",
            references: [reference],
          },
        ],
    noiseHandling: {
      removedChatterSummary: "짧은 잡담은 제거했습니다.",
      keptBecause: ["결정 근거와 이어지는 농담은 보존했습니다."],
    },
    notionProperties: options.notionProperties ?? {},
  };
}

function makeSpeakers(speakers: SpeakerFixture[]): NotionDraftSpeaker[] {
  return speakers.map(([displayName, isBot], index) => ({
    user_id: `user-${index}`,
    display_name_snapshot: displayName,
    is_bot: isBot,
    first_seen_at_ms: index * 1000,
    last_seen_at_ms: index * 1000 + 1000,
    chunk_count: 1,
  }));
}

function makeTimelineEntries(): TranscriptSegmentRow[] {
  return [
    makeTimelineEntry({
      id: "seg-1",
      chunkId: "chunk-1",
      sttJobId: "stt-1",
      userId: "user-0",
      speaker: "Taniar",
      startMs: 0,
      endMs: 60000,
      text: "이번 주 진행 상황을 공유하겠습니다.",
    }),
    makeTimelineEntry({
      id: "seg-2",
      chunkId: "chunk-2",
      sttJobId: "stt-2",
      userId: "user-1",
      speaker: "Ari",
      startMs: 62000,
      endMs: 90000,
      text: "Notion 업로드는 수동부터 확인하면 좋겠습니다.",
    }),
  ];
}

function makeTimelineEntry(input: {
  id: string;
  chunkId: string;
  sttJobId: string;
  userId: string;
  speaker: string;
  startMs: number;
  endMs: number;
  text: string;
}): TranscriptSegmentRow {
  return {
    id: input.id,
    session_id: "session-1",
    chunk_id: input.chunkId,
    stt_job_id: input.sttJobId,
    user_id: input.userId,
    display_name_snapshot: input.speaker,
    start_ms: input.startMs,
    end_ms: input.endMs,
    text: input.text,
    speech_status: "speech",
    source: "real",
    provider: "local-whisper",
    model: "test-stt",
    input_audio_sha256: "audio-hash",
    created_at: "2026-05-07T19:00:00+09:00",
    updated_at: "2026-05-07T19:00:00+09:00",
  };
}
