import assert from "node:assert/strict";
import test from "node:test";
import { formatSttRunSummary } from "./stt-summary.js";

test("formatSttRunSummary renders the shared fake STT summary shape", () => {
  const output = formatSttRunSummary({
    title: "디롱이 Fake STT 결과",
    dbPath: "data/dirong.sqlite",
    mode: "dry-run",
    result: {
      limit: 2,
      sessionId: null,
      expiredLeasesReleased: 0,
      examined: 1,
      done: 0,
      missingAudio: 1,
      failed: 0,
      remainingQueuedHint: 0,
      samples: [{ jobId: "job", chunkId: "chunk", speaker: "Taniar", status: "would_transcribe" }],
    },
  });

  assert.match(output, /^디롱이 Fake STT 결과\nDB: data\/dirong.sqlite\nmode: dry-run\nlimit: 2/m);
  assert.match(output, /session: all/);
  assert.match(output, /samples:\n\[/);
});

test("formatSttRunSummary preserves provider-specific detail and note lines", () => {
  const output = formatSttRunSummary({
    title: "디롱이 Real STT 결과",
    dbPath: "data/dirong.sqlite",
    mode: "write",
    detailLines: ["provider: openai", "model: whisper-1", "language: ko"],
    noteLines: ["OPENAI_API_KEY는 없지만 현재 provider dry-run에는 필요하지 않습니다."],
    result: {
      limit: 1,
      sessionId: "session-1",
      expiredLeasesReleased: 2,
      examined: 1,
      done: 1,
      missingAudio: 0,
      failed: 0,
      remainingQueuedHint: 1,
      samples: [],
    },
  });

  assert.match(output, /mode: write\nprovider: openai\nmodel: whisper-1\nlanguage: ko\nlimit: 1/);
  assert.match(output, /more queued jobs hint: yes/);
  assert.match(output, /OPENAI_API_KEY/);
});
