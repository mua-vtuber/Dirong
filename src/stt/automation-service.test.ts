import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SessionStore } from "../storage/session-store.js";
import { DirongDatabase } from "../storage/sqlite.js";
import { SttAutomationService } from "./automation-service.js";
import { FakeSttProvider } from "./provider.js";

test("SttAutomationService processes queued STT jobs", async () => {
  const fixture = createQueuedSttFixture();
  try {
    const service = new SttAutomationService(fixture.store, {
      enabled: true,
      provider: new FakeSttProvider(),
      pollIntervalMs: 1000,
      batchLimit: 1,
      runner: {
        workerId: "stt-auto-test",
        leaseMs: 60000,
        language: "ko",
        timeoutMs: 1000,
        contextSegments: 2,
      },
    });

    const snapshot = await service.runOnce();

    assert.equal(snapshot.status, "done");
    assert.equal(snapshot.lastRun?.examined, 1);
    assert.equal(snapshot.lastRun?.done, 1);
    assert.equal(fixture.countQueuedSttJobs(), 0);
    assert.equal(fixture.countTranscriptSegments(), 1);
  } finally {
    fixture.close();
  }
});

test("SttAutomationService disabled mode does not process jobs", async () => {
  const fixture = createQueuedSttFixture();
  try {
    const service = new SttAutomationService(fixture.store, {
      enabled: false,
      provider: new FakeSttProvider(),
      pollIntervalMs: 1000,
      batchLimit: 1,
      runner: {
        workerId: "stt-auto-test",
        leaseMs: 60000,
        language: "ko",
        timeoutMs: 1000,
        contextSegments: 2,
      },
    });

    const snapshot = await service.runOnce();

    assert.equal(snapshot.status, "disabled");
    assert.equal(fixture.countQueuedSttJobs(), 1);
  } finally {
    fixture.close();
  }
});

function createQueuedSttFixture(): {
  store: SessionStore;
  close: () => void;
  countQueuedSttJobs: () => number;
  countTranscriptSegments: () => number;
} {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-stt-auto-"));
  const database = new DirongDatabase(path.join(dir, "dirong.sqlite"), 1000);
  const store = new SessionStore(database);
  const sessionId = "meeting_stt_auto_test";
  const chunkId = `${sessionId}_000001_speaker`;
  const rawAudioPath = path.join(dir, "chunk.ogg");
  const sttAudioPath = path.join(dir, "chunk.webm");
  writeFileSync(rawAudioPath, "raw");
  writeFileSync(sttAudioPath, "stt");

  store.createSession({
    id: sessionId,
    guildId: "guild",
    guildName: "Guild",
    textChannelId: "text",
    voiceChannelId: "voice",
    voiceChannelName: "Voice",
    startedByUserId: "starter",
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
  store.createChunkWriting({
    chunkId,
    sessionId,
    chunkIndex: 1,
    userId: "speaker",
    displayNameSnapshot: "Taniar",
    startedAtMs: 1000,
    rawAudioPath,
  });
  store.finalizeRawChunk({
    chunkId,
    endedAtMs: 2000,
    durationMs: 1000,
    rawByteSize: 10,
    rawSha256: "raw",
    closeReason: "test",
    pipelineError: null,
  });
  store.completeChunkTranscodeAndQueueJob({
    chunkId,
    sttAudioPath,
    sttAudioFormat: "webm",
    sttByteSize: 10,
    sttSha256: "stt",
    maxAttempts: 3,
  });

  return {
    store,
    close: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
    countQueuedSttJobs: () => {
      const row = database.db
        .prepare("SELECT COUNT(*) AS count FROM stt_jobs WHERE status = 'queued'")
        .get() as { count: number };
      return row.count;
    },
    countTranscriptSegments: () => {
      const row = database.db
        .prepare("SELECT COUNT(*) AS count FROM transcript_segments")
        .get() as { count: number };
      return row.count;
    },
  };
}
