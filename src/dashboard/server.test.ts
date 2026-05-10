import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Phase1Config } from "../config.js";
import type { RecordingProducer } from "../recording/recording-producer.js";
import type { SessionStore } from "../storage/session-store.js";
import type {
  DashboardNotionAutomationSource,
  DashboardNotionSource,
  DashboardSetupStatusSource,
} from "./server.js";
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

test("appendDashboardRuntimeSnapshots includes redacted Notion snapshot", () => {
  const state = {
    generatedAt: "2026-05-06T00:00:00.000Z",
  };

  const withNotion = appendDashboardRuntimeSnapshots(state, {
    notion: makeNotionSource(),
    notionAutomation: makeNotionAutomationSource(),
  }) as { notion: { settings: { apiKey: string } } };
  const serialized = JSON.stringify(withNotion);

  assert.equal(withNotion.notion.settings.apiKey, "[REDACTED]");
  assert.doesNotMatch(serialized, /ntn_test_secret/);
});

test("appendDashboardRuntimeSnapshots includes setup status without raw secrets", () => {
  const state = {
    generatedAt: "2026-05-10T00:00:00.000Z",
  };

  const withSetup = appendDashboardRuntimeSnapshots(state, {
    setupStatus: makeSetupStatusSource(),
  });
  const serialized = JSON.stringify(withSetup);

  assert.match(serialized, /not_configured/);
  assert.doesNotMatch(serialized, /discord-secret-raw-value/);
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
    assert.match(html, /Notion Property Rules/);
    assert.match(html, /대상 page URL/);
    assert.match(html, /data-protected-rule/);
    assert.match(html, /Members 규칙은 삭제할 수 없습니다/);
    assert.match(html, /escapeHtml/);
    assert.match(html, /fetch\('\/api\/state'/);
  } finally {
    await fixture.close();
  }
});

test("DashboardServer setup status API returns redacted configuration state", async () => {
  const fixture = await startDashboardFixture({
    setupStatus: makeSetupStatusSource(),
  });
  try {
    const response = await fetch(`${fixture.baseUrl}/api/setup/status`);
    const text = await response.text();
    const body = JSON.parse(text) as { status: string };

    assert.equal(response.status, 200);
    assert.equal(body.status, "not_configured");
    assert.doesNotMatch(text, /discord-secret-raw-value/);
    assert.match(text, /\[REDACTED\]/);
  } finally {
    await fixture.close();
  }
});

test("DashboardServer getUrl reports the actual bound port", async () => {
  const dashboard = new DashboardServer(
    makeDashboardConfig(),
    makeStore(),
    makeProducer(),
  );
  await dashboard.start();
  const server = (dashboard as unknown as { server: Server | null }).server;
  assert.ok(server);
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    assert.equal(dashboard.getUrl(), `http://127.0.0.1:${address.port}/`);
  } finally {
    server.closeAllConnections();
    await dashboard.stop();
  }
});

test("DashboardServer reports occupied dashboard ports without a raw stack", async () => {
  const first = new DashboardServer(
    makeDashboardConfig(),
    makeStore(),
    makeProducer(),
  );
  await first.start();
  const firstServer = (first as unknown as { server: Server | null }).server;
  assert.ok(firstServer);
  const address = firstServer.address();
  assert.ok(address && typeof address === "object");

  const second = new DashboardServer(
    { ...makeDashboardConfig(), dashboardPort: address.port },
    makeStore(),
    makeProducer(),
  );

  try {
    await assert.rejects(
      () => second.start(),
      (error) => {
        const typed = error as Error & { code?: string };
        assert.equal(typed.code, "DASHBOARD_PORT_IN_USE");
        assert.match(typed.message, /이미 사용 중/);
        assert.match(typed.message, /dashboard 설정/);
        return true;
      },
    );
  } finally {
    firstServer.closeAllConnections();
    await first.stop();
    await second.stop();
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

test("DashboardServer Notion send action posts explicit JSON action", async () => {
  const actions: Array<{
    sessionId: string | null;
    draftId: string | null;
    force: boolean;
  }> = [];
  const fixture = await startDashboardFixture({
    notion: makeNotionSource(actions),
  });
  try {
    const response = await fetch(`${fixture.baseUrl}/api/notion/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "session-1", draftId: "draft-1" }),
    });
    const body = await response.json() as {
      ok: boolean;
      status: string;
      pageUrl: string;
    };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.status, "done");
    assert.equal(body.pageUrl, "https://notion.so/page");
    assert.deepEqual(actions, [
      { sessionId: "session-1", draftId: "draft-1", force: false },
    ]);
  } finally {
    await fixture.close();
  }
});

test("DashboardServer Notion retry action forces retry and never returns token", async () => {
  const actions: Array<{
    sessionId: string | null;
    draftId: string | null;
    force: boolean;
  }> = [];
  const fixture = await startDashboardFixture({
    notion: makeNotionSource(actions),
  });
  try {
    const response = await fetch(`${fixture.baseUrl}/api/notion/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "session-1" }),
    });
    const text = await response.text();

    assert.equal(response.status, 200);
    assert.doesNotMatch(text, /ntn_test_secret/);
    assert.deepEqual(actions, [
      { sessionId: "session-1", draftId: null, force: true },
    ]);
  } finally {
    await fixture.close();
  }
});

test("DashboardServer Notion property rules save through dashboard source", async () => {
  const savedRules: Array<{
    originalPropertyName?: string | null;
    propertyName: string;
    propertyType?: string | null;
    valueSource?: string | null;
    enabled: boolean;
    promptDescription: string;
    maxLength?: number | null;
    relationTargetUrl?: string | null;
    relationDataSourceId?: string | null;
    relationTargetPageUrl?: string | null;
    relationTargetPageId?: string | null;
    relationMatchPropertyName?: string | null;
    relationAutoCreate?: boolean | null;
    deleted?: boolean;
  }> = [];
  const fixture = await startDashboardFixture({
    notion: makeNotionSource([], savedRules),
  });
  try {
    const response = await fetch(`${fixture.baseUrl}/api/notion/properties`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rules: [
          {
            propertyName: "Discussion",
            propertyType: "rich_text",
            valueSource: "ai",
            enabled: true,
            promptDescription: "회의 논의 사항 요약",
            maxLength: 700,
          },
        ],
      }),
    });
    const body = await response.json() as { ok: boolean; status: string };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.status, "done");
    assert.deepEqual(savedRules, [
      {
        originalPropertyName: null,
        propertyName: "Discussion",
        propertyType: "rich_text",
        valueSource: "ai",
        enabled: true,
        promptDescription: "회의 논의 사항 요약",
        maxLength: 700,
        relationTargetUrl: null,
        relationDataSourceId: null,
        relationTargetPageUrl: null,
        relationTargetPageId: null,
        relationMatchPropertyName: null,
        relationAutoCreate: false,
        deleted: false,
      },
    ]);
  } finally {
    await fixture.close();
  }
});

test("DashboardServer Notion schema apply posts safe options", async () => {
  const schemaApplies: Array<{
    createMissing: boolean;
    updateTypes: boolean;
    deleteExtra: boolean;
    confirmDeleteExtra: boolean;
  }> = [];
  const fixture = await startDashboardFixture({
    notion: makeNotionSource([], [], schemaApplies),
  });
  try {
    const response = await fetch(`${fixture.baseUrl}/api/notion/schema/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        updateTypes: true,
        deleteExtra: true,
        confirmDeleteExtra: false,
      }),
    });
    const body = await response.json() as { ok: boolean; status: string };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.status, "done");
    assert.deepEqual(schemaApplies, [
      {
        createMissing: true,
        updateTypes: true,
        deleteExtra: true,
        confirmDeleteExtra: false,
      },
    ]);
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
  notion?: DashboardNotionSource;
  setupStatus?: DashboardSetupStatusSource;
};

async function startDashboardFixture(
  options: DashboardFixtureOptions = {},
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const dashboard = new DashboardServer(
    makeDashboardConfig(),
    makeStore(options.audio),
    makeProducer(),
    {
      ...(options.notion ? { notion: options.notion } : {}),
      ...(options.setupStatus ? { setupStatus: options.setupStatus } : {}),
    },
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

function makeNotionSource(
  actions: Array<{
    sessionId: string | null;
    draftId: string | null;
    force: boolean;
  }> = [],
  savedRules: Array<{
    originalPropertyName?: string | null;
    propertyName: string;
    propertyType?: string | null;
    valueSource?: string | null;
    enabled: boolean;
    promptDescription: string;
    maxLength?: number | null;
    relationTargetUrl?: string | null;
    relationDataSourceId?: string | null;
    relationTargetPageUrl?: string | null;
    relationTargetPageId?: string | null;
    relationMatchPropertyName?: string | null;
    relationAutoCreate?: boolean | null;
    deleted?: boolean;
  }> = [],
  schemaApplies: Array<{
    createMissing: boolean;
    updateTypes: boolean;
    deleteExtra: boolean;
    confirmDeleteExtra: boolean;
  }> = [],
): DashboardNotionSource {
  return {
    getSnapshot: () => ({
      enabled: true,
      configured: true,
      status: "ready",
      uploadMode: "manual",
      targetUrl: "https://notion.so/db",
      message: "Notion upload is configured.",
      userAction: null,
      settings: {
        enabled: true,
        apiKey: "[REDACTED]",
        apiVersion: "2026-03-11",
        baseUrl: "https://api.notion.com",
        targetUrl: "https://notion.so/db",
        targetType: "data_source",
        uploadMode: "manual",
        templateType: "app",
        includeTranscript: "never",
        autoPollMs: 5000,
        leaseMs: 600000,
        maxAttempts: 3,
        propertyNames: {
          title: "Name",
          date: "Date",
          meetingTime: "Meeting Time",
          channel: "Channel",
          participants: "Participants",
          status: "Status",
          sessionId: "Session ID",
          draftId: "Draft ID",
          contentHash: "Dirong Content Hash",
          localStatus: "Local Status",
        },
      },
      customProperties: {
        supportedTypes: ["rich_text", "select", "multi_select", "checkbox", "date"],
        requiredPropertyNames: [
          "Name",
          "Date",
          "Meeting Time",
          "Channel",
          "Participants",
          "Status",
          "Session ID",
          "Draft ID",
          "Dirong Content Hash",
          "Local Status",
        ],
        rules: [
          {
            propertyName: "Discussion",
            propertyId: "discussion",
            propertyType: "rich_text",
            valueSource: "ai",
            enabled: false,
            promptDescription: "",
            maxLength: 1000,
            relationTargetUrl: null,
            relationDataSourceId: null,
            relationTargetPageUrl: null,
            relationTargetPageId: null,
            relationMatchPropertyName: "Name",
            relationAutoCreate: false,
            lastSeenAt: "2026-05-07T00:00:00.000Z",
            createdAt: "2026-05-07T00:00:00.000Z",
            updatedAt: "2026-05-07T00:00:00.000Z",
          },
        ],
        enabledCount: 0,
        promptPreview: "",
        message: "사용자 속성 1개 중 0개가 켜져 있습니다.",
        userAction: null,
      },
    }),
    runManualUpload: async (input) => {
      actions.push(input);
      return {
        ok: true,
        status: "done",
        message: "complete",
        userAction: null,
        pageUrl: "https://notion.so/page",
      };
    },
    syncCustomProperties: async () => ({
      ok: true,
      status: "done",
      message: "synced",
      userAction: null,
      warnings: [],
      customProperties: makeNotionSource().getSnapshot().customProperties,
    }),
    saveCustomPropertyRules: (rules) => {
      savedRules.push(...rules);
      return {
        ok: true,
        status: "done",
        message: "saved",
        userAction: null,
        warnings: [],
        customProperties: makeNotionSource().getSnapshot().customProperties,
      };
    },
    inspectSchema: async () => ({
      ok: true,
      status: "done",
      message: "누락 0 / 이름변경 0 / 타입불일치 0 / 옵션누락 0 / 관리외 0",
      userAction: null,
      warnings: [],
      diff: null,
      operations: null,
    }),
    applySchema: async (input) => {
      schemaApplies.push(input);
      return {
        ok: true,
        status: "done",
        message: "생성 0 / 이름변경 0 / 타입변경 0 / 옵션보강 0 / 삭제 0",
        userAction: null,
        warnings: [],
        diff: null,
        operations: {
          create: 0,
          rename: 0,
          updateType: 0,
          updateOptions: 0,
          delete: 0,
        },
      };
    },
  };
}

function makeSetupStatusSource(): DashboardSetupStatusSource {
  return {
    getSnapshot: () => ({
      generatedAt: "2026-05-10T00:00:00.000Z",
      status: "not_configured",
      userDataDir: "C:\\Users\\Taniar\\AppData\\Local\\Dirong",
      settingsPath: "C:\\Users\\Taniar\\AppData\\Local\\Dirong\\settings\\settings.json",
      secretsPath: "C:\\Users\\Taniar\\AppData\\Local\\Dirong\\secrets\\secrets.json",
      databasePath: "C:\\Users\\Taniar\\AppData\\Local\\Dirong\\sessions\\dirong.sqlite",
      secrets: {
        discordBot: {
          configured: true,
          displayValue: "[REDACTED]",
        },
        openAi: {
          configured: false,
          displayValue: "[MISSING]",
        },
        claude: {
          configured: false,
          displayValue: "[MISSING]",
        },
        notion: {
          configured: false,
          displayValue: "[MISSING]",
        },
      },
      features: {
        discord: {
          status: "not_configured",
          message: "Discord 설정이 아직 없습니다.",
          userAction: "Discord 설정을 완료해 주세요.",
          missing: ["discord.applicationId"],
          applicationIdConfigured: false,
          guildAllowlistCount: 0,
        },
        recording: {
          status: "blocked",
          message: "녹음 시작은 아직 막혀 있습니다.",
          userAction: "Discord와 STT 설정을 완료해 주세요.",
          missing: ["discord", "stt"],
        },
        stt: {
          status: "not_configured",
          message: "STT 설정이 아직 없습니다.",
          userAction: "STT provider를 선택해 주세요.",
          missing: ["stt.provider"],
          provider: null,
          model: null,
        },
        ai: {
          status: "not_configured",
          message: "AI 설정이 아직 없습니다.",
          userAction: "Claude provider를 선택해 주세요.",
          missing: ["ai.provider"],
          provider: null,
          mode: null,
        },
        notion: {
          status: "not_configured",
          message: "Notion 설정이 아직 없습니다.",
          userAction: "Notion token과 parent page URL을 저장해 주세요.",
          missing: ["notion.token"],
          parentPageConfigured: false,
          managedRegistryReady: false,
        },
        dataRetention: {
          status: "ready",
          message: "기본 보관 정책이 적용되어 있습니다.",
          userAction: null,
          missing: [],
          deleteAudioAfterNotionUpload: true,
          textDraftRetentionDays: 30,
        },
      },
    }),
  };
}

function makeNotionAutomationSource(): DashboardNotionAutomationSource {
  return {
    getSnapshot: () => ({
      enabled: true,
      configured: true,
      uploadMode: "automatic_after_ai_cleanup",
      status: "idle",
      checkedAt: "2026-05-07T00:00:00.000Z",
      sessionId: null,
      draftId: null,
      targetId: "target-1",
      writeId: null,
      pageUrl: null,
      message: "Notion 자동 업로드 대기 중",
      userAction: null,
      technicalDetail: null,
      lastRunStatus: null,
      inFlightDraftIds: [],
      repairedExpiredLeases: 0,
    }),
  };
}

function makeDashboardConfig(): Phase1Config {
  return {
    discordBotToken: "",
    discordClientId: "",
    guildId: "",
    guildIds: [],
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
