import assert from "node:assert/strict";
import test from "node:test";
import type { Phase4TranscriptTimeline } from "../../transcript/timeline.js";
import {
  DraftValidationError,
  MEETING_NOTES_DRAFT_SCHEMA_VERSION,
  parseMeetingNotesDraftFromRawText,
  validateMeetingNotesDraftV1,
  type MeetingNotesDraftV1,
  type TimelineReference,
} from "./draft.js";

test("validateMeetingNotesDraftV1 accepts a valid draft without markdown", () => {
  const { draft, timeline } = createValidDraftFixture();
  assert.equal(
    validateMeetingNotesDraftV1(draft, {
      sessionId: draft.sessionId,
      inputHash: draft.sourceTimeline.inputHash,
      timeline,
    }),
    draft,
  );
});

test("validateMeetingNotesDraftV1 drops a legacy markdown key before validation", () => {
  const { draft, timeline } = createValidDraftFixture();
  const normalized = validateMeetingNotesDraftV1(
    {
      ...draft,
      markdown: "# legacy markdown",
    },
    {
      sessionId: draft.sessionId,
      inputHash: draft.sourceTimeline.inputHash,
      timeline,
    },
  );

  assert.equal("markdown" in normalized, false);
});

test("validateMeetingNotesDraftV1 rejects unknown top-level extra keys", () => {
  const { draft, timeline } = createValidDraftFixture();
  assert.throws(
    () =>
      validateMeetingNotesDraftV1(
        {
          ...draft,
          markdown: "# legacy markdown",
          metadata: { generatedAt: "now" },
        },
        {
          sessionId: draft.sessionId,
          inputHash: draft.sourceTimeline.inputHash,
          timeline,
        },
      ),
    /metadata is not allowed/,
  );
});

test("validateMeetingNotesDraftV1 rejects schemaVersion mismatch", () => {
  const { draft, timeline } = createValidDraftFixture();
  assert.throws(
    () =>
      validateMeetingNotesDraftV1(
        { ...draft, schemaVersion: "wrong" },
        {
          sessionId: draft.sessionId,
          inputHash: draft.sourceTimeline.inputHash,
          timeline,
        },
      ),
    DraftValidationError,
  );
});

test("validateMeetingNotesDraftV1 rejects action items without references", () => {
  const { draft, timeline } = createValidDraftFixture();
  const invalid: MeetingNotesDraftV1 = {
    ...draft,
    actionItems: [
      {
        id: "action_1",
        task: "정리하기",
        owner: {
          status: "unspecified",
          name: null,
          userId: null,
          evidence: [],
        },
        dueDate: {
          status: "unspecified",
          rawText: null,
          isoDate: null,
          evidence: [],
        },
        references: [],
      },
    ],
  };

  assert.throws(
    () =>
      validateMeetingNotesDraftV1(invalid, {
        sessionId: draft.sessionId,
        inputHash: draft.sourceTimeline.inputHash,
        timeline,
      }),
    /references/,
  );
});

test("validateMeetingNotesDraftV1 rejects owner and date hallucination", () => {
  const { draft, timeline, reference } = createValidDraftFixture();
  const invalid: MeetingNotesDraftV1 = {
    ...draft,
    actionItems: [
      {
        id: "action_1",
        task: "회의록 정리",
        owner: {
          status: "explicit",
          name: "Mina",
          userId: null,
          evidence: [reference],
        },
        dueDate: {
          status: "explicit",
          rawText: "금요일",
          isoDate: "2026-05-08",
          evidence: [reference],
        },
        references: [reference],
      },
    ],
  };

  assert.throws(
    () =>
      validateMeetingNotesDraftV1(invalid, {
        sessionId: draft.sessionId,
        inputHash: draft.sourceTimeline.inputHash,
        timeline,
      }),
    /owner|isoDate/,
  );
});

test("parseMeetingNotesDraftFromRawText extracts code-fenced JSON", () => {
  const { draft } = createValidDraftFixture();
  assert.deepEqual(
    parseMeetingNotesDraftFromRawText(
      ["```json", JSON.stringify(draft), "```"].join("\n"),
    ),
    draft,
  );
});

test("parseMeetingNotesDraftFromRawText extracts fenced JSON from a Claude result envelope", () => {
  const { draft } = createValidDraftFixture();
  const envelope = {
    type: "result",
    result: ["```json", JSON.stringify(draft), "```"].join("\n"),
  };

  assert.deepEqual(parseMeetingNotesDraftFromRawText(JSON.stringify(envelope)), draft);
});

test("parseMeetingNotesDraftFromRawText extracts the last JSON object after prose", () => {
  const { draft } = createValidDraftFixture();
  const draftWithBracesInString: MeetingNotesDraftV1 = {
    ...draft,
    summary: {
      ...draft.summary,
      text: "문자열 안의 {중괄호}는 JSON 경계가 아닙니다.",
    },
  };
  const raw = [
    "초안은 아래 JSON에 있습니다.",
    "{\"ignored\":true}",
    JSON.stringify(draftWithBracesInString),
    "끝.",
  ].join("\n");

  assert.deepEqual(
    parseMeetingNotesDraftFromRawText(raw),
    draftWithBracesInString,
  );
});

test("validateMeetingNotesDraftV1 normalizes noiseHandling.keptBecause reason objects", () => {
  const { draft, timeline } = createValidDraftFixture();
  const normalized = validateMeetingNotesDraftV1(
    {
      ...draft,
      noiseHandling: {
        ...draft.noiseHandling,
        keptBecause: [
          { reason: "일정과 담당자 언급이 있습니다." },
          { chunkId: "chunk_1", reason: "회의록 정리 맥락이 있습니다." },
        ],
      },
    },
    {
      sessionId: draft.sessionId,
      inputHash: draft.sourceTimeline.inputHash,
      timeline,
    },
  );

  assert.deepEqual(normalized.noiseHandling.keptBecause, [
    "일정과 담당자 언급이 있습니다.",
    "회의록 정리 맥락이 있습니다.",
  ]);
});

test("validateMeetingNotesDraftV1 normalizes common Haiku action item shape drift", () => {
  const { draft, timeline, reference } = createValidDraftFixture();
  const normalized = validateMeetingNotesDraftV1(
    {
      ...draft,
      actionItems: [
        {
          id: "action_1",
          task: "조용한 환경에서 현상 관찰",
          owner: "unspecified",
          dueDate: {
            rawText: "즉시",
            isoDate: null,
          },
          references: [reference],
        },
      ],
    },
    {
      sessionId: draft.sessionId,
      inputHash: draft.sourceTimeline.inputHash,
      timeline,
    },
  );

  assert.deepEqual(normalized.actionItems[0]?.owner, {
    status: "unspecified",
    name: null,
    userId: null,
    evidence: [],
  });
  assert.deepEqual(normalized.actionItems[0]?.dueDate, {
    status: "unspecified",
    rawText: null,
    isoDate: null,
    evidence: [],
  });
});

test("validateMeetingNotesDraftV1 fills explicit dueDate evidence when rawText is grounded", () => {
  const { draft, timeline, reference } = createValidDraftFixture();
  const normalized = validateMeetingNotesDraftV1(
    {
      ...draft,
      actionItems: [
        {
          id: "action_1",
          task: "회의록 정리",
          owner: {
            status: "unspecified",
            name: null,
          },
          dueDate: {
            rawText: "금요일",
            isoDate: null,
          },
          references: [reference],
        },
      ],
    },
    {
      sessionId: draft.sessionId,
      inputHash: draft.sourceTimeline.inputHash,
      timeline,
    },
  );

  assert.deepEqual(normalized.actionItems[0]?.owner, {
    status: "unspecified",
    name: null,
    userId: null,
    evidence: [],
  });
  assert.deepEqual(normalized.actionItems[0]?.dueDate, {
    status: "explicit",
    rawText: "금요일",
    isoDate: null,
    evidence: [reference],
  });
});

function createValidDraftFixture(): {
  timeline: Phase4TranscriptTimeline;
  reference: TimelineReference;
  draft: MeetingNotesDraftV1;
} {
  const timeline: Phase4TranscriptTimeline = {
    contractVersion: "phase3.5-transcript-timeline-v1",
    sessionId: "meeting_test",
    includeNoSpeech: false,
    includeFakeStt: false,
    entries: [
      {
        sessionId: "meeting_test",
        chunkId: "chunk_1",
        sttJobId: "stt_chunk_1",
        userId: "user_1",
        displayNameSnapshot: "Taniar",
        startMs: 1000,
        endMs: 2000,
        text: "제가 금요일까지 회의록을 정리할게요.",
        speechStatus: "speech",
        source: "real",
        provider: "local-whisper",
        model: "small",
        inputAudioSha256: "sha",
      },
    ],
  };
  const reference: TimelineReference = {
    chunkId: "chunk_1",
    sttJobId: "stt_chunk_1",
    startMs: 1000,
    endMs: 2000,
    speaker: "Taniar",
  };
  const draft: MeetingNotesDraftV1 = {
    schemaVersion: MEETING_NOTES_DRAFT_SCHEMA_VERSION,
    language: "ko",
    sessionId: "meeting_test",
    sourceTimeline: {
      contractVersion: timeline.contractVersion,
      inputHash: "hash",
      entryCount: 1,
    },
    meetingTitle: {
      text: "회의록 초안",
      confidence: "low",
      references: [reference],
    },
    summary: {
      text: "회의록 정리를 논의했습니다.",
      references: [reference],
    },
    topics: [
      {
        id: "topic_1",
        title: "회의록 정리",
        summary: "회의록 정리 담당과 일정을 이야기했습니다.",
        references: [reference],
      },
    ],
    decisions: [],
    actionItems: [],
    unresolvedItems: [],
    uncertaintyNotes: [],
    noiseHandling: {
      removedChatterSummary: "없음",
      keptBecause: ["일정과 담당자 언급이 있습니다."],
    },
    notionProperties: {},
  };

  return { timeline, reference, draft };
}
