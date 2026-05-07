import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Phase1Config } from "../config.js";
import type { RecordingProducer } from "../recording/recording-producer.js";
import type { SessionStore } from "../storage/session-store.js";
import {
  appendAiReadinessToDashboardState,
  appendDashboardRuntimeSnapshots,
  DashboardServer,
} from "./server.js";

test("appendAiReadinessToDashboardState includes runtime AI readiness with existing AI job data", () => {
  const state = {
    generatedAt: "2026-05-06T00:00:00.000Z",
    recentAiCleanupJobs: [{ id: "ai_job_1", status: "done" }],
    latestMeetingNotesDraft: { id: "draft_ai_job_1" },
  };

  const withReadiness = appendAiReadinessToDashboardState(state, {
    getSnapshot: () => ({
      status: "ready",
      provider: "claude-cli",
      model: "haiku",
      checkedAt: "2026-05-06T00:00:01.000Z",
      message: "AI 준비 완료",
      userAction: null,
      technicalDetail: null,
    }),
  });

  assert.deepEqual(withReadiness, {
    ...state,
    aiReadiness: {
      status: "ready",
      provider: "claude-cli",
      model: "haiku",
      checkedAt: "2026-05-06T00:00:01.000Z",
      message: "AI 준비 완료",
      userAction: null,
      technicalDetail: null,
    },
  });
});

test("appendAiReadinessToDashboardState leaves state unchanged without a source", () => {
  const state = {
    generatedAt: "2026-05-06T00:00:00.000Z",
  };

  assert.equal(appendAiReadinessToDashboardState(state), state);
});

test("appendDashboardRuntimeSnapshots includes AI cleanup automation snapshot", () => {
  const state = {
    generatedAt: "2026-05-06T00:00:00.000Z",
    recentAiCleanupJobs: [{ id: "ai_job_1", status: "done" }],
    latestMeetingNotesDraft: { id: "draft_ai_job_1" },
  };

  const withAutomation = appendDashboardRuntimeSnapshots(state, {
    aiCleanupAutomation: {
      getSnapshot: () => ({
        enabled: true,
        status: "waiting_for_stt",
        provider: "claude-cli",
        model: "haiku",
        checkedAt: "2026-05-06T00:00:01.000Z",
        sessionId: "meeting_1",
        message: "STT 완료 대기 중",
        userAction: null,
        technicalDetail: null,
        stt: null,
        job: null,
        lastRunStatus: null,
        inFlightSessionIds: [],
        repairedExpiredJobs: { requeued: 0, failed: 0 },
        repairedExpiredSttLeases: 0,
        warnings: [],
        progress: null,
      }),
    },
  });

  assert.deepEqual(withAutomation, {
    ...state,
    aiCleanupAutomation: {
      enabled: true,
      status: "waiting_for_stt",
      provider: "claude-cli",
      model: "haiku",
      checkedAt: "2026-05-06T00:00:01.000Z",
      sessionId: "meeting_1",
      message: "STT 완료 대기 중",
      userAction: null,
      technicalDetail: null,
      stt: null,
      job: null,
      lastRunStatus: null,
      inFlightSessionIds: [],
      repairedExpiredJobs: { requeued: 0, failed: 0 },
      repairedExpiredSttLeases: 0,
      warnings: [],
      progress: null,
    },
  });
});

test("appendDashboardRuntimeSnapshots includes alone finalize snapshot", () => {
  const state = {
    generatedAt: "2026-05-06T00:00:00.000Z",
  };

  const withAloneFinalize = appendDashboardRuntimeSnapshots(state, {
    aloneFinalize: {
      getSnapshot: () => ({
        enabled: true,
        status: "countdown",
        checkedAt: "2026-05-06T00:00:01.000Z",
        sessionId: "meeting_1",
        voiceChannelId: "voice_1",
        aloneSince: "2026-05-06T00:00:01.000Z",
        finalizeAt: "2026-05-06T00:01:31.000Z",
        remainingMs: 90000,
        nonBotMemberCount: 0,
        message: "혼자 남음 감지, 90초 후 자동 종료",
        userAction: "grace 시간 안에 사람이 돌아오면 자동 종료가 취소됩니다.",
        technicalDetail: null,
        warnings: [],
      }),
    },
  });

  assert.deepEqual(withAloneFinalize, {
    ...state,
    aloneFinalize: {
      enabled: true,
      status: "countdown",
      checkedAt: "2026-05-06T00:00:01.000Z",
      sessionId: "meeting_1",
      voiceChannelId: "voice_1",
      aloneSince: "2026-05-06T00:00:01.000Z",
      finalizeAt: "2026-05-06T00:01:31.000Z",
      remainingMs: 90000,
      nonBotMemberCount: 0,
      message: "혼자 남음 감지, 90초 후 자동 종료",
      userAction: "grace 시간 안에 사람이 돌아오면 자동 종료가 취소됩니다.",
      technicalDetail: null,
      warnings: [],
    },
  });
});

test("appendDashboardRuntimeSnapshots includes STT automation snapshot", () => {
  const state = {
    generatedAt: "2026-05-06T00:00:00.000Z",
    recentSttJobs: [{ id: "stt_job_1", status: "done" }],
  };

  const withSttAutomation = appendDashboardRuntimeSnapshots(state, {
    sttAutomation: {
      getSnapshot: () => ({
        enabled: true,
        status: "done",
        provider: "whisper-cli",
        model: "tiny",
        checkedAt: "2026-05-06T00:00:01.000Z",
        message: "STT batch 처리 완료",
        userAction: null,
        technicalDetail: null,
        lastRun: {
          workerId: "phase3-stt-auto-whisper-cli-123",
          dryRun: false,
          limit: 1,
          sessionId: null,
          source: "real",
          provider: "whisper-cli",
          model: "tiny",
          language: "ko",
          expiredLeasesReleased: 0,
          examined: 1,
          done: 1,
          missingAudio: 0,
          failed: 0,
          remainingQueuedHint: 0,
          samples: [],
        },
      }),
    },
  });

  assert.deepEqual(withSttAutomation, {
    ...state,
    sttAutomation: {
      enabled: true,
      status: "done",
      provider: "whisper-cli",
      model: "tiny",
      checkedAt: "2026-05-06T00:00:01.000Z",
      message: "STT batch 처리 완료",
      userAction: null,
      technicalDetail: null,
      lastRun: {
        workerId: "phase3-stt-auto-whisper-cli-123",
        dryRun: false,
        limit: 1,
        sessionId: null,
        source: "real",
        provider: "whisper-cli",
        model: "tiny",
        language: "ko",
        expiredLeasesReleased: 0,
        examined: 1,
        done: 1,
        missingAudio: 0,
        failed: 0,
        remainingQueuedHint: 0,
        samples: [],
      },
    },
  });
});

test("DashboardServer root serves the dashboard HTML without caching", async () => {
  const fixture = await startDashboardFixture();
  try {
    const response = await fetch(`${fixture.baseUrl}/`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(html, /Dirong Recording \+ STT Dashboard/);
    assert.match(html, /escapeHtml/);
    assert.match(html, /fetch\('\/api\/state'/);
  } finally {
    await fixture.close();
  }
});

test("DashboardServer audio endpoint serves full and ranged raw audio", async () => {
  const fixture = await startDashboardFixture({
    audio: {
      chunkId: "chunk_audio_test",
      raw: {
        path: writeAudioFixture("chunk-audio-", "raw.ogg", "0123456789"),
        format: "ogg-opus",
      },
    },
  });
  try {
    const full = await fetch(`${fixture.baseUrl}/audio/chunk_audio_test/raw`);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get("content-length"), "10");
    assert.equal(Buffer.from(await full.arrayBuffer()).toString("utf8"), "0123456789");

    const range = await fetch(`${fixture.baseUrl}/audio/chunk_audio_test/raw`, {
      headers: { range: "bytes=2-5" },
    });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get("content-range"), "bytes 2-5/10");
    assert.equal(Buffer.from(await range.arrayBuffer()).toString("utf8"), "2345");
  } finally {
    await fixture.close();
  }
});

test("DashboardServer audio endpoint rejects unsatisfiable ranges", async () => {
  const fixture = await startDashboardFixture({
    audio: {
      chunkId: "chunk_audio_test",
      raw: {
        path: writeAudioFixture("chunk-audio-", "raw.ogg", "0123456789"),
        format: "ogg-opus",
      },
    },
  });
  try {
    const response = await fetch(`${fixture.baseUrl}/audio/chunk_audio_test/raw`, {
      headers: { range: "bytes=20-30" },
    });

    assert.equal(response.status, 416);
    assert.equal(response.headers.get("content-range"), "bytes */10");
  } finally {
    await fixture.close();
  }
});

test("DashboardServer audio endpoint serves STT-safe audio separately", async () => {
  const fixture = await startDashboardFixture({
    audio: {
      chunkId: "chunk_audio_test",
      raw: {
        path: writeAudioFixture("chunk-audio-", "raw.ogg", "raw"),
        format: "ogg-opus",
      },
      stt: {
        path: writeAudioFixture("chunk-audio-", "stt.webm", "stt"),
        format: "webm",
      },
    },
  });
  try {
    const response = await fetch(`${fixture.baseUrl}/audio/chunk_audio_test/stt`);

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /audio\/webm/);
    assert.equal(Buffer.from(await response.arrayBuffer()).toString("utf8"), "stt");
  } finally {
    await fixture.close();
  }
});

type AudioFixture = {
  chunkId: string;
  raw?: { path: string; format: string };
  stt?: { path: string; format: string };
};

type DashboardFixtureOptions = {
  audio?: AudioFixture;
};

async function startDashboardFixture(
  options: DashboardFixtureOptions = {},
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const dashboard = new DashboardServer(
    makeDashboardConfig(),
    makeStore(options.audio),
    makeProducer(),
  );
  await dashboard.start();

  const server = (dashboard as unknown as { server: Server | null }).server;
  assert.ok(server);
  const address = server.address();
  assert.ok(address && typeof address === "object");

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections();
      await dashboard.stop();
    },
  };
}

function makeDashboardConfig(): Phase1Config {
  return {
    discordBotToken: "",
    discordClientId: "",
    guildId: "",
    dataDir: ".",
    dbPath: "dirong.sqlite",
    dbBusyTimeoutMs: 1000,
    silenceMs: 1000,
    softRolloverMs: 60000,
    maxChunkMs: 120000,
    sttSafeFormat: "webm",
    sttMaxAttempts: 3,
    sttLeaseMs: 900000,
    partRepairAgeMs: 300000,
    enableDave: true,
    decryptionFailureTolerance: 24,
    debugVoice: false,
    autoRegisterCommands: false,
    dashboardHost: "127.0.0.1",
    dashboardPort: 0,
    openDashboard: false,
    aloneFinalizeEnabled: false,
    aloneFinalizeGraceMs: 90000,
  };
}

function makeStore(audio?: AudioFixture): SessionStore {
  return {
    getDashboardState: () => ({
      generatedAt: "2026-05-07T00:00:00.000Z",
      runtime: { isRecording: false },
    }),
    getAudioPathForChunk: (chunkId: string, kind: "raw" | "stt") => {
      if (audio?.chunkId !== chunkId) {
        return null;
      }
      return audio[kind] ?? null;
    },
  } as unknown as SessionStore;
}

function makeProducer(): RecordingProducer {
  return {
    getRuntimeState: () => ({
      isRecording: false,
      sessionId: null,
      voiceChannelId: null,
      voiceChannelName: null,
      openChunks: 0,
    }),
  } as unknown as RecordingProducer;
}

function writeAudioFixture(prefix: string, fileName: string, contents: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  const filePath = path.join(dir, fileName);
  writeFileSync(filePath, contents);
  test.after(() => rmSync(dir, { recursive: true, force: true }));
  return filePath;
}
