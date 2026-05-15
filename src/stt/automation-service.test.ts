import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createStorageContext,
  flattenStorageContext,
  type FlatStorageStore,
} from "../storage/storage-context.js";
import { DirongDatabase } from "../storage/sqlite.js";
import {
  formatSttAutomationForStatus,
  SttAutomationService,
  type SttAutomationSnapshot,
} from "./automation-service.js";
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
    assert.equal(snapshot.display?.title, "STT 설정이 준비됐어요");
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

test("SttAutomationService localizes runtime snapshot with app locale", async () => {
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
      localeResolver: () => "en",
    });

    const snapshot = await service.runOnce();

    assert.equal(snapshot.message, "STT automation is turned off.");
    assert.equal(snapshot.userAction, "Run the manual Phase 3 STT CLI if needed.");
    assert.equal(snapshot.display?.title, "STT setup is not finished yet");
    assert.equal(snapshot.provider, "dirong-fake-stt");
  } finally {
    fixture.close();
  }
});

test("formatSttAutomationForStatus localizes text labels", () => {
  const snapshot: SttAutomationSnapshot = {
    enabled: true,
    status: "idle",
    provider: "local-whisper",
    model: "base",
    checkedAt: "2026-05-06T00:00:00.000Z",
    message: "STT 자동 실행 대기 중",
    userAction: null,
    technicalDetail: null,
    lastRun: {
      workerId: "stt-test",
      dryRun: false,
      limit: 1,
      sessionId: null,
      source: "real",
      provider: "local-whisper",
      model: "base",
      language: null,
      expiredLeasesReleased: 0,
      examined: 0,
      done: 0,
      failed: 0,
      missingAudio: 0,
      remainingQueuedHint: 0,
      samples: [],
    },
  };

  assert.match(formatSttAutomationForStatus(snapshot), /STT 자동화/);
  assert.match(formatSttAutomationForStatus(snapshot, "en"), /STT automation/);
  assert.match(formatSttAutomationForStatus(snapshot, "en"), /STT batch:/);
});

function createQueuedSttFixture(): {
  store: FlatStorageStore;
  close: () => void;
  countQueuedSttJobs: () => number;
  countTranscriptSegments: () => number;
} {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-stt-auto-"));
  const database = new DirongDatabase(path.join(dir, "dirong.sqlite"), 1000);
  const ctx = createStorageContext(database);
  const store = flattenStorageContext(ctx);
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
