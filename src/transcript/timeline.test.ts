import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SessionStore } from "../storage/session-store.js";
import { DirongDatabase } from "../storage/sqlite.js";
import {
  buildPhase4TranscriptTimeline,
  renderPhase4TranscriptTimelineMarkdown,
} from "./timeline.js";

test("buildPhase4TranscriptTimeline excludes no_speech by default", () => {
  const fixture = createFixtureStore();
  try {
    addCompletedTranscript(fixture.store, {
      chunkIndex: 1,
      startMs: 1000,
      endMs: 2000,
      text: "안녕하세요",
    });
    const noSpeech = addCompletedTranscript(fixture.store, {
      chunkIndex: 2,
      startMs: 3000,
      endMs: 3500,
      text: "",
    });

    assert.equal(noSpeech.speech_status, "no_speech");

    const timeline = buildPhase4TranscriptTimeline(fixture.store, {
      sessionId: fixture.sessionId,
    });

    assert.equal(timeline.contractVersion, "phase3.5-transcript-timeline-v1");
    assert.equal(timeline.entries.length, 1);
    assert.equal(timeline.entries[0]?.text, "안녕하세요");
    assert.equal(timeline.entries[0]?.speechStatus, "speech");
    assert.equal(renderPhase4TranscriptTimelineMarkdown(timeline), "[00:01] Taniar: 안녕하세요");
  } finally {
    fixture.close();
  }
});

test("buildPhase4TranscriptTimeline excludes fake STT by default", () => {
  const fixture = createFixtureStore();
  try {
    addCompletedTranscript(fixture.store, {
      chunkIndex: 1,
      startMs: 1000,
      endMs: 2000,
      text: "실제 발화입니다.",
    });
    addCompletedTranscript(fixture.store, {
      chunkIndex: 2,
      startMs: 3000,
      endMs: 4000,
      text: "[FAKE STT] source 기준 fake입니다.",
      source: "fake",
      provider: "local-whisper",
    });
    addCompletedTranscript(fixture.store, {
      chunkIndex: 3,
      startMs: 5000,
      endMs: 6000,
      text: "provider 기준 fake입니다.",
      source: "real",
      provider: "dirong-fake-stt",
    });

    const timeline = buildPhase4TranscriptTimeline(fixture.store, {
      sessionId: fixture.sessionId,
    });

    assert.equal(timeline.includeFakeStt, false);
    assert.equal(timeline.entries.length, 1);
    assert.equal(timeline.entries[0]?.text, "실제 발화입니다.");
  } finally {
    fixture.close();
  }
});

test("buildPhase4TranscriptTimeline can include fake STT for diagnostics", () => {
  const fixture = createFixtureStore();
  try {
    addCompletedTranscript(fixture.store, {
      chunkIndex: 1,
      startMs: 1000,
      endMs: 2000,
      text: "[FAKE STT] smoke test transcript",
      source: "fake",
      provider: "dirong-fake-stt",
    });

    const timeline = buildPhase4TranscriptTimeline(fixture.store, {
      sessionId: fixture.sessionId,
      includeFakeStt: true,
    });

    assert.equal(timeline.includeFakeStt, true);
    assert.equal(timeline.entries.length, 1);
    assert.equal(timeline.entries[0]?.source, "fake");
    assert.equal(timeline.entries[0]?.provider, "dirong-fake-stt");
  } finally {
    fixture.close();
  }
});

test("buildPhase4TranscriptTimeline keeps short speech", () => {
  const fixture = createFixtureStore();
  try {
    addCompletedTranscript(fixture.store, {
      chunkIndex: 1,
      startMs: 1000,
      endMs: 1500,
      text: "네",
    });

    const timeline = buildPhase4TranscriptTimeline(fixture.store, {
      sessionId: fixture.sessionId,
    });

    assert.equal(timeline.entries.length, 1);
    assert.equal(timeline.entries[0]?.text, "네");
    assert.equal(timeline.entries[0]?.speechStatus, "speech");
  } finally {
    fixture.close();
  }
});

test("buildPhase4TranscriptTimeline can include no_speech for diagnostics", () => {
  const fixture = createFixtureStore();
  try {
    addCompletedTranscript(fixture.store, {
      chunkIndex: 1,
      startMs: 1000,
      endMs: 2000,
      text: "",
    });

    const timeline = buildPhase4TranscriptTimeline(fixture.store, {
      sessionId: fixture.sessionId,
      includeNoSpeech: true,
    });

    assert.equal(timeline.entries.length, 1);
    assert.equal(timeline.entries[0]?.speechStatus, "no_speech");
    assert.equal(renderPhase4TranscriptTimelineMarkdown(timeline), "[00:01] Taniar: (no speech)");
  } finally {
    fixture.close();
  }
});

function createFixtureStore(): {
  store: SessionStore;
  sessionId: string;
  close: () => void;
} {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-timeline-"));
  const database = new DirongDatabase(path.join(dir, "dirong.sqlite"), 1000);
  const store = new SessionStore(database);
  const sessionId = "meeting_test";

  store.createSession({
    id: sessionId,
    guildId: "guild",
    guildName: "Guild",
    textChannelId: "text",
    voiceChannelId: "voice",
    voiceChannelName: "Voice",
    startedByUserId: "user",
    startedByDisplayName: "Taniar",
    dataDir: dir,
  });
  store.upsertSpeaker({
    sessionId,
    userId: "speaker",
    displayNameSnapshot: "Taniar",
    isBot: false,
    seenAtMs: 0,
  });

  return {
    store,
    sessionId,
    close: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function addCompletedTranscript(
  store: SessionStore,
  input: {
    chunkIndex: number;
    startMs: number;
    endMs: number;
    text: string;
    source?: string;
    provider?: string;
    model?: string;
  },
) {
  const chunkId = `meeting_test_${String(input.chunkIndex).padStart(6, "0")}_speaker`;
  store.createChunkWriting({
    chunkId,
    sessionId: "meeting_test",
    chunkIndex: input.chunkIndex,
    userId: "speaker",
    displayNameSnapshot: "Taniar",
    startedAtMs: input.startMs,
    rawAudioPath: path.join(os.tmpdir(), `${chunkId}.ogg`),
  });
  store.finalizeRawChunk({
    chunkId,
    endedAtMs: input.endMs,
    durationMs: input.endMs - input.startMs,
    rawByteSize: 10,
    rawSha256: "raw",
    closeReason: "test",
    pipelineError: null,
  });
  store.completeChunkTranscodeAndQueueJob({
    chunkId,
    sttAudioPath: path.join(os.tmpdir(), `${chunkId}.webm`),
    sttAudioFormat: "webm",
    sttByteSize: 10,
    sttSha256: "stt",
    maxAttempts: 3,
  });

  const job = store.claimNextSttJob({
    workerId: "timeline-test",
    leaseMs: 60000,
    sessionId: "meeting_test",
  });
  assert.ok(job);

  return store.completeSttJob({
    job,
    text: input.text,
    source: input.source ?? "real",
    provider: input.provider ?? "local-whisper",
    model: input.model ?? "test-model",
    inputAudioSha256: "stt",
  });
}
