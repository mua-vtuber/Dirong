import assert from "node:assert/strict";
import test from "node:test";
import {
  appendAiReadinessToDashboardState,
  appendDashboardRuntimeSnapshots,
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
        warnings: [],
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
      warnings: [],
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
