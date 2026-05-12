import assert from "node:assert/strict";
import test from "node:test";
import {
  MEETING_NOTES_DRAFT_SCHEMA_VERSION,
  type MeetingNotesDraftV1,
  type TimelineReference,
} from "./draft.js";
import { renderMeetingNotesDraftMarkdown } from "./markdown-renderer.js";

test("renderMeetingNotesDraftMarkdown renders core Korean sections", () => {
  const markdown = renderMeetingNotesDraftMarkdown(createDraftFixture(), {
    maxLineLength: 80,
  });

  assert.match(markdown, /^# 디롱이 회의록 정리$/m);
  assert.match(markdown, /^## 요약$/m);
  assert.match(markdown, /^## 주요 주제$/m);
  assert.match(markdown, /^## 결정 사항$/m);
  assert.match(markdown, /^## 할 일 목록$/m);
  assert.match(markdown, /^## 미해결\/불확실한 항목$/m);
  assert.match(markdown, /^## 잡담\/노이즈 처리$/m);
  assert.match(markdown, /^## 출처 타임라인$/m);
  assert.match(markdown, /\[확정\] Markdown 렌더링 분리/);
  assert.match(markdown, /담당: Taniar/);
  assert.match(markdown, /기한: 금요일/);
  assert.match(markdown, /미해결: Notion API 연동 범위/);
  assert.match(markdown, /불확실: 장기 회의 map-reduce 범위/);
  assert.match(markdown, /`chunk_1`\/`stt_chunk_1` 00:01-00:02 Taniar/);
});

test("renderMeetingNotesDraftMarkdown handles empty arrays naturally", () => {
  const draft = createDraftFixture();
  const markdown = renderMeetingNotesDraftMarkdown({
    ...draft,
    topics: [],
    decisions: [],
    actionItems: [],
    unresolvedItems: [],
    uncertaintyNotes: [],
    noiseHandling: {
      removedChatterSummary: "없음",
      keptBecause: [],
    },
  });

  assert.match(markdown, /^## 주요 주제\n\n- 없음$/m);
  assert.match(markdown, /^## 결정 사항\n\n- 없음$/m);
  assert.match(markdown, /^## 할 일 목록\n\n- 없음$/m);
  assert.match(markdown, /^## 미해결\/불확실한 항목\n\n- 없음$/m);
  assert.match(markdown, /- 보존 이유: 없음/);
});

function createDraftFixture(): MeetingNotesDraftV1 {
  const reference: TimelineReference = {
    chunkId: "chunk_1",
    sttJobId: "stt_chunk_1",
    startMs: 1000,
    endMs: 2000,
    speaker: "Taniar",
  };

  return {
    schemaVersion: MEETING_NOTES_DRAFT_SCHEMA_VERSION,
    language: "ko",
    sessionId: "meeting_test",
    sourceTimeline: {
      contractVersion: "phase3.5-transcript-timeline-v1",
      inputHash: "hash",
      entryCount: 1,
    },
    meetingTitle: {
      text: "디롱이 회의록 정리",
      confidence: "high",
      references: [reference],
    },
    summary: {
      text: "Claude는 의미 구조 JSON만 만들고 Markdown은 앱에서 렌더링하기로 했습니다.",
      references: [reference],
    },
    topics: [
      {
        id: "topic_1",
        title: "Phase 4.1 구조",
        summary: "AI output과 Markdown 렌더링 책임을 분리했습니다.",
        references: [reference],
      },
    ],
    decisions: [
      {
        id: "decision_1",
        title: "Markdown 렌더링 분리",
        detail: "앱 renderer가 DB와 artifact용 Markdown을 생성합니다.",
        status: "decided",
        references: [reference],
      },
    ],
    actionItems: [
      {
        id: "action_1",
        task: "renderer 테스트를 추가한다.",
        owner: {
          status: "explicit",
          name: "Taniar",
          userId: "user_1",
          evidence: [reference],
        },
        dueDate: {
          status: "explicit",
          rawText: "금요일",
          isoDate: null,
          evidence: [reference],
        },
        references: [reference],
      },
    ],
    unresolvedItems: [
      {
        id: "unresolved_1",
        text: "Notion API 연동 범위",
        reason: "Phase 5 이전에는 local draft까지만 생성합니다.",
        references: [reference],
      },
    ],
    uncertaintyNotes: [
      {
        id: "uncertainty_1",
        text: "장기 회의 map-reduce 범위는 아직 정하지 않았습니다.",
        references: [reference],
      },
    ],
    noiseHandling: {
      removedChatterSummary: "회의 의미와 무관한 짧은 반응은 요약에서 제외했습니다.",
      keptBecause: ["담당자와 일정 단서는 회의록 의미에 필요합니다."],
    },
    notionProperties: {},
  };
}
