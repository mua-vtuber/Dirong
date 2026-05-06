import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { RecordingRuntimeState } from "./session-store.js";
import { SessionStore } from "./session-store.js";
import { DirongDatabase } from "./sqlite.js";

test("SessionStore dashboard read model returns current session slices", () => {
  const fixture = createFixture();
  try {
    seedDashboardSession(fixture);
    const runtime: RecordingRuntimeState = {
      isRecording: false,
      sessionId: fixture.sessionId,
      voiceChannelId: null,
      voiceChannelName: null,
      openChunks: 0,
    };

    const state = fixture.store.getDashboardState(runtime) as {
      currentSession?: { id: string };
      speakers?: Array<{ user_id: string }>;
      recentChunks?: Array<{ id: string; stt_job_id: string }>;
      recentSttJobs?: Array<{ id: string; status: string }>;
      queueStats?: Array<{ status: string; count: number }>;
    };

    assert.equal(state.currentSession?.id, fixture.sessionId);
    assert.equal(state.speakers?.[0]?.user_id, "speaker");
    assert.equal(state.recentChunks?.[0]?.id, fixture.chunkId);
    assert.equal(state.recentChunks?.[0]?.stt_job_id, `stt_${fixture.chunkId}`);
    assert.equal(state.recentSttJobs?.[0]?.status, "queued");
    assert.deepEqual(state.queueStats, [{ status: "queued", count: 1 }]);
  } finally {
    fixture.close();
  }
});

type DashboardFixture = {
  dir: string;
  database: DirongDatabase;
  store: SessionStore;
  sessionId: string;
  chunkId: string;
  close: () => void;
};

function createFixture(): DashboardFixture {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-dashboard-read-"));
  const database = new DirongDatabase(path.join(dir, "dirong.sqlite"), 1000);
  const store = new SessionStore(database);
  const sessionId = "meeting_dashboard_read";
  const chunkId = `${sessionId}_000001_speaker`;
  return {
    dir,
    database,
    store,
    sessionId,
    chunkId,
    close: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function seedDashboardSession(fixture: DashboardFixture): void {
  fixture.store.createSession({
    id: fixture.sessionId,
    guildId: "guild",
    guildName: "Guild",
    textChannelId: "text",
    voiceChannelId: "voice",
    voiceChannelName: "Voice",
    startedByUserId: "starter",
    startedByDisplayName: "Taniar",
    dataDir: fixture.dir,
  });
  fixture.store.upsertSpeaker({
    sessionId: fixture.sessionId,
    userId: "speaker",
    displayNameSnapshot: "Taniar",
    isBot: false,
    seenAtMs: 0,
  });
  fixture.store.createChunkWriting({
    chunkId: fixture.chunkId,
    sessionId: fixture.sessionId,
    chunkIndex: 1,
    userId: "speaker",
    displayNameSnapshot: "Taniar",
    startedAtMs: 0,
    rawAudioPath: path.join(fixture.dir, "chunk.ogg"),
  });
  fixture.store.finalizeRawChunk({
    chunkId: fixture.chunkId,
    endedAtMs: 1000,
    durationMs: 1000,
    rawByteSize: 10,
    rawSha256: "raw-sha",
    closeReason: "test",
    pipelineError: null,
  });
  fixture.store.completeChunkTranscodeAndQueueJob({
    chunkId: fixture.chunkId,
    sttAudioPath: path.join(fixture.dir, "chunk.webm"),
    sttAudioFormat: "webm",
    sttByteSize: 10,
    sttSha256: "stt-sha",
    maxAttempts: 3,
  });
}
