import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTimelineReferenceIndex,
  getReferencedTimelineEntries,
  timelineReferenceKey,
  toTimelineReference,
} from "./reference-index.js";
import type { Phase4TranscriptTimeline } from "../../../transcript/timeline.js";

test("timeline reference index uses one canonical key format", () => {
  const timeline = makeTimeline();
  const entry = timeline.entries[0];
  if (!entry) {
    throw new Error("fixture entry missing");
  }

  const index = buildTimelineReferenceIndex(timeline);

  assert.equal(timelineReferenceKey("chunk_1", "stt_1"), "chunk_1\u0000stt_1");
  assert.equal(
    index.get(timelineReferenceKey({ chunkId: "chunk_1", sttJobId: "stt_1" })),
    entry,
  );
  assert.deepEqual(toTimelineReference(entry), {
    chunkId: "chunk_1",
    sttJobId: "stt_1",
    startMs: 1000,
    endMs: 2000,
    speaker: "Taniar",
  });
});

test("referenced timeline entry lookup ignores malformed references", () => {
  const timeline = makeTimeline();

  assert.deepEqual(
    getReferencedTimelineEntries(
      [
        { chunkId: "missing", sttJobId: "stt_1" },
        { chunkId: "chunk_1", sttJobId: "stt_1" },
        { chunkId: "chunk_1" },
        "not an object",
      ],
      timeline,
    ).map((entry) => entry.chunkId),
    ["chunk_1"],
  );
});

function makeTimeline(): Phase4TranscriptTimeline {
  return {
    contractVersion: "phase3.5-transcript-timeline-v1",
    sessionId: "session_1",
    includeNoSpeech: false,
    includeFakeStt: false,
    entries: [
      {
        sessionId: "session_1",
        chunkId: "chunk_1",
        sttJobId: "stt_1",
        userId: "user_1",
        displayNameSnapshot: "Taniar",
        startMs: 1000,
        endMs: 2000,
        text: "다음 주까지 정리합니다.",
        source: "stt",
        speechStatus: "speech",
        provider: "fake",
        model: "fake",
        inputAudioSha256: null,
      },
    ],
  };
}
