import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { connect, type Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Phase1Config } from "../config.js";
import type { ActiveProjectSwitchBlockReason } from "../projects/active-project-service.js";
import type { DirongProjectRow } from "../projects/project-types.js";
import type { RecordingProducer } from "../recording/recording-producer.js";
import type { SessionStore } from "../storage/session-store.js";
import type { DirongLocale } from "../settings/local-settings-store.js";
import { LocalSettingsStore } from "../settings/local-settings-store.js";
import { LocalSecretStore } from "../settings/local-secret-store.js";
import { getDirongUserDataPaths } from "../settings/dirong-user-data.js";
import {
  DEFAULT_DASHBOARD_SETTINGS,
  DEFAULT_NOTION_SETTINGS,
  DEFAULT_RECORDING_SETTINGS,
  DEFAULT_RETENTION_SETTINGS,
  DEFAULT_SETUP_AI_SETTINGS,
  DEFAULT_STT_SETTINGS,
} from "../settings/defaults.js";
import { SetupWizardService } from "../setup/wizard-service.js";
import type {
  DashboardNotionAutomationSource,
  DashboardNotionSource,
  DashboardProjectsSource,
  DashboardSettingsResetSource,
  DashboardSetupStatusSource,
  DashboardSetupWizardSource,
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

test("appendDashboardRuntimeSnapshots includes project snapshots without secret refs", () => {
  const state = {
    generatedAt: "2026-05-13T00:00:00.000Z",
  };

  const withProjects = appendDashboardRuntimeSnapshots(state, {
    projects: makeProjectsSource(),
  }) as {
    projects: {
      activeProjectId: string | null;
      projects: Array<{
        id: string;
        lifecycleStatus: string;
        notionConnectionConfigured: boolean;
        notion_token_secret_ref?: string;
      }>;
    };
  };
  const serialized = JSON.stringify(withProjects);

  assert.equal(withProjects.projects.activeProjectId, "project-ready");
  assert.equal(withProjects.projects.projects[0]?.lifecycleStatus, "ready");
  assert.equal(
    withProjects.projects.projects[0]?.notionConnectionConfigured,
    true,
  );
  assert.equal(withProjects.projects.projects[0]?.notion_token_secret_ref, undefined);
  assert.doesNotMatch(serialized, /notion\.project\.project-ready\.token/);
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
    assert.match(html, /app-shell/);
    assert.match(html, /statusChips/);
    assert.match(html, /id="setupView"/);
    assert.match(html, /id="setupWizard"/);
    assert.match(html, /body\[data-view="setup"\] \.sidebar/);
    assert.match(html, /\/assets\/dirong\/dirong_head\.png/);
    assert.doesNotMatch(html, /관리 외 삭제/);
    assert.match(html, /window\.__DIRONG_DASHBOARD_TOKEN__/);
    assert.match(html, /\/dashboard\/api-client\.js/);
    assert.match(html, /\/dashboard\/setup-wizard\.js/);
    assert.match(html, /\/dashboard\/notion-properties\.js/);
    assert.match(html, /\/dashboard\/notion-managed-db\.js/);
    assert.match(html, /\/dashboard\/dashboard-client\.js/);
    assert.doesNotMatch(html, /function refresh/);
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
    const body = JSON.parse(text) as {
      status: string;
      secrets: { discordBot: { configured: boolean; displayValue: string } };
      features: { discord: { display?: { title: string } } };
    };

    assert.equal(response.status, 200);
    assert.equal(body.status, "not_configured");
    assert.deepEqual(body.secrets.discordBot, {
      configured: true,
      displayValue: "[REDACTED]",
    });
    assert.equal(
      body.features.discord.display?.title,
      "Discord 봇 연결이 아직 끝나지 않았어요",
    );
    assert.doesNotMatch(text, /discord-secret-raw-value/);
    assert.match(text, /\[REDACTED\]/);
  } finally {
    await fixture.close();
  }
});

test("DashboardServer mutation routes require JSON, same-origin, and dashboard token", async () => {
  const setupStatus = makeMutableSetupStatusSource();
  const fixture = await startDashboardFixture({ setupStatus });
  try {
    const missingToken = await fetch(`${fixture.baseUrl}/api/settings/language`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: "en" }),
    });
    assert.equal(missingToken.status, 403);
    assert.equal(setupStatus.getLocale?.(), "ko");

    const dashboardToken = await readDashboardToken(fixture.baseUrl);
    const wrongContentType = await fetch(`${fixture.baseUrl}/api/settings/language`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "X-Dirong-Dashboard-Token": dashboardToken,
      },
      body: JSON.stringify({ locale: "en" }),
    });
    assert.equal(wrongContentType.status, 415);
    assert.equal(setupStatus.getLocale?.(), "ko");

    const crossOrigin = await fetch(`${fixture.baseUrl}/api/settings/language`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": "http://example.invalid",
        "X-Dirong-Dashboard-Token": dashboardToken,
      },
      body: JSON.stringify({ locale: "en" }),
    });
    assert.equal(crossOrigin.status, 403);
    assert.equal(setupStatus.getLocale?.(), "ko");

    const sameOrigin = await postJson(
      fixture.baseUrl,
      "/api/settings/language",
      { locale: "en" },
      {
        Origin: fixture.baseUrl,
        "Sec-Fetch-Site": "same-origin",
      },
    );
    assert.equal(sameOrigin.status, 200);
    assert.equal(setupStatus.getLocale?.(), "en");
  } finally {
    await fixture.close();
  }
});

test("DashboardServer setup wizard routes read state and post actions through the wizard source", async () => {
  const calls: unknown[] = [];
  const fixture = await startDashboardFixture({
    setupStatus: makeMutableSetupStatusSource(),
    setupWizard: makeSetupWizardSource(calls),
  });
  try {
    const state = await fetch(`${fixture.baseUrl}/api/setup/state`);
    const stateBody = await state.json() as {
      wizard: { currentStep: string };
    };
    assert.equal(state.status, 200);
    assert.equal(stateBody.wizard.currentStep, "discordApplication");

    const saved = await postJson(
      fixture.baseUrl,
      "/api/setup/discord/application-id",
      { applicationId: "123456789012345678" },
    );
    const savedBody = await saved.json() as {
      ok: boolean;
      messageKey: string;
      httpStatus?: number;
    };

    assert.equal(saved.status, 200);
    assert.equal(savedBody.ok, true);
    assert.equal(
      savedBody.messageKey,
      "setup.discord.applicationId.save.done.message",
    );
    assert.equal(savedBody.httpStatus, undefined);

    const installState = await fetch(
      `${fixture.baseUrl}/api/setup/stt/local-whisper/install`,
    );
    const installStateBody = await installState.json() as {
      ok: boolean;
      install: { status: string };
    };
    assert.equal(installState.status, 200);
    assert.equal(installStateBody.ok, true);
    assert.equal(installStateBody.install.status, "running");

    const installStarted = await postJson(
      fixture.baseUrl,
      "/api/setup/stt/local-whisper/install",
      { model: "small" },
    );
    const installStartedBody = await installStarted.json() as {
      ok: boolean;
      install: { status: string; model: string };
    };
    assert.equal(installStarted.status, 202);
    assert.equal(installStartedBody.ok, true);
    assert.equal(installStartedBody.install.status, "running");
    assert.equal(installStartedBody.install.model, "small");
    const openAiTested = await postJson(
      fixture.baseUrl,
      "/api/setup/stt/openai/test",
      { apiKey: "test-openai-key", model: "gpt-4o-mini-transcribe" },
    );
    const openAiTestedBody = await openAiTested.json() as { ok: boolean };
    assert.equal(openAiTested.status, 200);
    assert.equal(openAiTestedBody.ok, true);
    assert.deepEqual(calls, [
      { applicationId: "123456789012345678" },
      { model: "small" },
      { apiKey: "test-openai-key", model: "gpt-4o-mini-transcribe" },
    ]);
  } finally {
    await fixture.close();
  }
});

test("DashboardServer project APIs list active project and create reusable draft", async () => {
  const projects = makeProjectsSource();
  const fixture = await startDashboardFixture({ projects });
  try {
    const listed = await fetch(`${fixture.baseUrl}/api/projects`);
    const listedBody = await listed.json() as {
      ok: boolean;
      activeProjectId: string | null;
      projects: Array<{
        id: string;
        lifecycleStatus: string;
        commandEnabled: boolean;
        notionConnectionConfigured: boolean;
        notionParentPageConfigured: boolean;
        notion_token_secret_ref?: string;
      }>;
    };
    const listedText = JSON.stringify(listedBody);

    assert.equal(listed.status, 200);
    assert.equal(listedBody.ok, true);
    assert.equal(listedBody.activeProjectId, "project-ready");
    assert.equal(listedBody.projects[0]?.lifecycleStatus, "ready");
    assert.equal(listedBody.projects[0]?.commandEnabled, true);
    assert.equal(listedBody.projects[0]?.notionConnectionConfigured, true);
    assert.equal(listedBody.projects[0]?.notionParentPageConfigured, true);
    assert.equal(listedBody.projects[0]?.notion_token_secret_ref, undefined);
    assert.doesNotMatch(listedText, /notion\.project\.project-ready\.token/);
    assert.deepEqual(
      listedBody.projects.map((project) => project.id),
      ["project-ready", "project-empty-draft"],
    );

    const created = await postJson(fixture.baseUrl, "/api/projects", {
      name: "Renamed Draft",
    });
    const createdBody = await created.json() as {
      ok: boolean;
      reused: boolean;
      project: { id: string; name: string; notion_token_secret_ref?: string };
      switchResult: { ok: boolean; activeProject: { id: string } };
      activeProject: { id: string };
      activeProjectId: string | null;
    };

    assert.equal(created.status, 200);
    assert.equal(createdBody.ok, true);
    assert.equal(createdBody.reused, true);
    assert.equal(createdBody.project.id, "project-empty-draft");
    assert.equal(createdBody.project.name, "Renamed Draft");
    assert.equal(createdBody.project.notion_token_secret_ref, undefined);
    assert.equal(createdBody.switchResult.activeProject.id, "project-empty-draft");
    assert.equal(createdBody.activeProject.id, "project-empty-draft");
    assert.equal(createdBody.activeProjectId, "project-empty-draft");

    const active = await fetch(`${fixture.baseUrl}/api/projects/active`);
    const activeBody = await active.json() as {
      activeProjectId: string | null;
    };
    assert.equal(activeBody.activeProjectId, "project-empty-draft");

    const switched = await postJson(fixture.baseUrl, "/api/projects/active", {
      projectId: "project-ready",
    });
    const switchedBody = await switched.json() as {
      ok: boolean;
      status: string;
      activeProject: { id: string };
      activeProjectId: string | null;
    };

    assert.equal(switched.status, 200);
    assert.equal(switchedBody.ok, true);
    assert.equal(switchedBody.status, "done");
    assert.equal(switchedBody.activeProject.id, "project-ready");
    assert.equal(switchedBody.activeProjectId, "project-ready");
  } finally {
    await fixture.close();
  }
});

test("DashboardServer project switch API returns guard blocks", async () => {
  const projects = makeProjectsSource({
    blockReason: "recording_active",
  });
  const fixture = await startDashboardFixture({ projects });
  try {
    const response = await postJson(fixture.baseUrl, "/api/projects/active", {
      projectId: "project-ready",
    });
    const body = await response.json() as {
      ok: boolean;
      status: string;
      reason: string;
      activeProject: { id: string };
      activeProjectId: string | null;
    };

    assert.equal(response.status, 409);
    assert.equal(body.ok, false);
    assert.equal(body.status, "blocked");
    assert.equal(body.reason, "recording_active");
    assert.equal(body.activeProject.id, "project-ready");
    assert.equal(body.activeProjectId, "project-ready");

    const notFoundProjects = makeProjectsSource();
    const notFoundFixture = await startDashboardFixture({
      projects: notFoundProjects,
    });
    try {
      const notFound = await postJson(
        notFoundFixture.baseUrl,
        "/api/projects/active",
        { projectId: "missing-project" },
      );
      const notFoundBody = await notFound.json() as {
        ok: boolean;
        status: string;
        reason: string;
        activeProjectId: string | null;
      };

      assert.equal(notFound.status, 404);
      assert.equal(notFoundBody.ok, false);
      assert.equal(notFoundBody.status, "blocked");
      assert.equal(notFoundBody.reason, "project_not_found");
      assert.equal(notFoundBody.activeProjectId, "project-ready");
    } finally {
      await notFoundFixture.close();
    }
  } finally {
    await fixture.close();
  }
});

test("DashboardServer settings reset route validates body and returns reset results", async () => {
  const calls: string[] = [];
  const fixture = await startDashboardFixture({
    settingsReset: makeSettingsResetSource(calls),
  });
  try {
    const invalid = await postJson(fixture.baseUrl, "/api/settings/reset", {
      mode: "full",
    });
    const success = await postJson(fixture.baseUrl, "/api/settings/reset", {
      mode: "current_project_connection",
      confirm: true,
    });
    const body = await success.json() as {
      ok: boolean;
      status: string;
      mode: string;
      deleted: { blockedNotionWrites: number };
      activeProjectId: string | null;
    };

    assert.equal(invalid.status, 400);
    assert.equal(success.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.status, "done");
    assert.equal(body.mode, "current_project_connection");
    assert.equal(body.deleted.blockedNotionWrites, 2);
    assert.equal(body.activeProjectId, "project-fresh");
    assert.deepEqual(calls, ["current_project_connection"]);
  } finally {
    await fixture.close();
  }
});

test("DashboardServer settings reset route forwards 409 conflicts", async () => {
  const fixture = await startDashboardFixture({
    settingsReset: makeSettingsResetSource([], "notion_upload_in_flight"),
  });
  try {
    const response = await postJson(fixture.baseUrl, "/api/settings/reset", {
      mode: "full",
      confirm: true,
    });
    const body = await response.json() as {
      ok: boolean;
      status: string;
      reason: string;
    };

    assert.equal(response.status, 409);
    assert.equal(body.ok, false);
    assert.equal(body.status, "blocked");
    assert.equal(body.reason, "notion_upload_in_flight");
  } finally {
    await fixture.close();
  }
});

test("DashboardServer settings reset route reports reset failures as 500", async () => {
  const fixture = await startDashboardFixture({
    settingsReset: {
      reset: async () => {
        throw new Error("reset exploded");
      },
    },
  });
  try {
    const response = await postJson(fixture.baseUrl, "/api/settings/reset", {
      mode: "current_project_connection",
      confirm: true,
    });
    const body = await response.json() as {
      ok: boolean;
      status: string;
      message: string;
      detail: string;
    };

    assert.equal(response.status, 500);
    assert.equal(body.ok, false);
    assert.equal(body.status, "failed");
    assert.equal(body.message, "Settings reset failed.");
    assert.match(body.detail, /reset exploded/);
  } finally {
    await fixture.close();
  }
});

test("DashboardServer setup STT route lets the wizard apply server defaults", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-dashboard-setup-"));
  const paths = getDirongUserDataPaths(dir);
  const settingsStore = new LocalSettingsStore(paths.settingsFile);
  const secretStore = new LocalSecretStore(paths.secretsFile);
  const fixture = await startDashboardFixture({
    setupWizard: new SetupWizardService({
      paths,
      settingsStore,
      secretStore,
    }),
  });
  try {
    const response = await postJson(fixture.baseUrl, "/api/setup/stt", {
      provider: "local-whisper",
    });
    const body = await response.json() as { ok: boolean };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.deepEqual(settingsStore.read().stt, {
      provider: "local-whisper",
      language: DEFAULT_STT_SETTINGS.language,
      timeoutMs: DEFAULT_STT_SETTINGS.timeoutMs,
      localWhisper: {
        profile: DEFAULT_STT_SETTINGS.localWhisper.profile,
        command: undefined,
        args: undefined,
        model: DEFAULT_STT_SETTINGS.localWhisper.model,
        device: DEFAULT_STT_SETTINGS.localWhisper.device,
        computeType: DEFAULT_STT_SETTINGS.localWhisper.computeType,
      },
      openAiApiKeySecretRef: undefined,
      openAiModel: undefined,
    });
  } finally {
    await fixture.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("DashboardServer setup recording route saves alone finalize wait time", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-dashboard-recording-"));
  const paths = getDirongUserDataPaths(dir);
  const settingsStore = new LocalSettingsStore(paths.settingsFile);
  const secretStore = new LocalSecretStore(paths.secretsFile);
  const fixture = await startDashboardFixture({
    setupWizard: new SetupWizardService({
      paths,
      settingsStore,
      secretStore,
    }),
  });
  try {
    const response = await postJson(
      fixture.baseUrl,
      "/api/setup/recording/alone-finalize",
      {
        enabled: true,
        graceSeconds: 120,
      },
    );
    const body = await response.json() as {
      ok: boolean;
      runtimeEffect?: { scope: string; kind: string };
    };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.runtimeEffect?.scope, "recording");
    assert.equal(body.runtimeEffect?.kind, "restart_required");
    assert.deepEqual(settingsStore.read().recording, {
      aloneFinalizeEnabled: true,
      aloneFinalizeGraceMs: 120000,
    });
  } finally {
    await fixture.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("DashboardServer language API reads and saves app locale", async () => {
  const setupStatus = makeMutableSetupStatusSource();
  const fixture = await startDashboardFixture({ setupStatus });
  try {
    const initial = await fetch(`${fixture.baseUrl}/api/settings/language`);
    const initialBody = await initial.json() as {
      locale: string;
      notionSchemaLocale: string;
      messageKey: string;
    };

    assert.equal(initial.status, 200);
    assert.equal(initialBody.locale, "ko");
    assert.equal(initialBody.notionSchemaLocale, "ko");
    assert.equal(initialBody.messageKey, "settings.language.current.message");

    const saved = await postJson(fixture.baseUrl, "/api/settings/language", {
      locale: "en",
    });
    const savedBody = await saved.json() as {
      locale: string;
      notionSchemaLocale: string;
      messageKey: string;
      setup: { locale: string };
    };

    assert.equal(saved.status, 200);
    assert.equal(savedBody.locale, "en");
    assert.equal(savedBody.notionSchemaLocale, "en");
    assert.equal(savedBody.messageKey, "settings.language.save.done.message");
    assert.equal(savedBody.setup.locale, "en");

    const next = await fetch(`${fixture.baseUrl}/api/setup/language`);
    const nextBody = await next.json() as { locale: string };
    assert.equal(nextBody.locale, "en");
  } finally {
    await fixture.close();
  }
});

test("DashboardServer language API rejects unsupported locales", async () => {
  const setupStatus = makeMutableSetupStatusSource();
  const fixture = await startDashboardFixture({ setupStatus });
  try {
    const response = await postJson(fixture.baseUrl, "/api/settings/language", {
      locale: "jp",
    });
    const body = await response.json() as {
      locale: string;
      messageKey: string;
      userActionKey: string;
    };

    assert.equal(response.status, 400);
    assert.equal(body.locale, "ko");
    assert.equal(body.messageKey, "settings.language.error.invalidLocale.message");
    assert.equal(body.userActionKey, "settings.language.error.invalidLocale.action");
    assert.equal(setupStatus.getLocale?.(), "ko");
  } finally {
    await fixture.close();
  }
});

test("DashboardServer theme API reads and saves dashboard theme", async () => {
  const setupStatus = makeMutableSetupStatusSource();
  const fixture = await startDashboardFixture({ setupStatus });
  try {
    const initial = await fetch(`${fixture.baseUrl}/api/settings/theme`);
    const initialBody = await initial.json() as { theme: string };

    assert.equal(initial.status, 200);
    assert.equal(initialBody.theme, "system");

    const saved = await postJson(fixture.baseUrl, "/api/settings/theme", {
      theme: "dark",
    });
    const savedBody = await saved.json() as {
      theme: string;
      messageKey: string;
      setup: { dashboardTheme: string };
    };

    assert.equal(saved.status, 200);
    assert.equal(savedBody.theme, "dark");
    assert.equal(savedBody.messageKey, "settings.theme.save.done.message");
    assert.equal(savedBody.setup.dashboardTheme, "dark");
    assert.equal(setupStatus.getTheme?.(), "dark");
  } finally {
    await fixture.close();
  }
});

test("DashboardServer exposes locale catalog messages", async () => {
  const fixture = await startDashboardFixture({
    setupStatus: makeMutableSetupStatusSource(),
  });
  try {
    const response = await fetch(`${fixture.baseUrl}/api/i18n`);
    const body = await response.json() as {
      locale: string;
      messages: Record<string, string>;
    };

    assert.equal(response.status, 200);
    assert.equal(body.locale, "ko");
    assert.equal(body.messages["dashboard.nav.dashboard"], "대시보드");
    assert.equal(
      body.messages["dashboard.setupWizard.discord.guide.botTokenTitle"],
      "애플리케이션 ID 발급 후 봇 토큰 복사 방법",
    );
    assert.equal(
      body.messages["dashboard.setupWizard.discord.guide.botTokenStep5"],
      "디롱이 페이지로 돌아와 디스코드 봇 토큰 칸에 붙여넣고 저장합니다.",
    );
    assert.notEqual(
      body.messages["dashboard.setupWizard.discord.guide.botTokenStep5"],
      "[REDACTED]",
    );
  } finally {
    await fixture.close();
  }
});

test("DashboardServer serves copied Dirong image assets", async () => {
  const fixture = await startDashboardFixture();
  try {
    const response = await fetch(`${fixture.baseUrl}/assets/dirong/dirong_head.png`);

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /image\/png/);
  } finally {
    await fixture.close();
  }
});

test("DashboardServer serves split dashboard client scripts", async () => {
  const fixture = await startDashboardFixture();
  try {
    const api = await fetch(`${fixture.baseUrl}/dashboard/api-client.js`);
    const setup = await fetch(`${fixture.baseUrl}/dashboard/setup-wizard.js`);
    const notion = await fetch(`${fixture.baseUrl}/dashboard/notion-properties.js`);
    const managedDb = await fetch(`${fixture.baseUrl}/dashboard/notion-managed-db.js`);
    const dashboard = await fetch(`${fixture.baseUrl}/dashboard/dashboard-client.js`);
    const apiText = await api.text();
    const setupText = await setup.text();
    const notionText = await notion.text();
    const managedDbText = await managedDb.text();
    const dashboardText = await dashboard.text();

    assert.equal(api.status, 200);
    assert.equal(setup.status, 200);
    assert.equal(notion.status, 200);
    assert.equal(managedDb.status, 200);
    assert.equal(dashboard.status, 200);
    assert.match(api.headers.get("content-type") ?? "", /text\/javascript/);
    assert.equal(api.headers.get("cache-control"), "no-store");
    assert.match(apiText, /dashboardJsonHeaders/);
    assert.match(apiText, /SETUP_SKIP_DASHBOARD_KEY/);
    assert.match(apiText, /sessionStorage/);
    assert.match(apiText, /document\.body\.dataset\.view/);
    assert.match(apiText, /syncActiveViewForSetup/);
    assert.match(apiText, /dashboardApiGetProjects/);
    assert.match(apiText, /\/api\/projects\/active/);
    assert.match(apiText, /dashboardApiResetSettings/);
    assert.match(apiText, /\/api\/settings\/reset/);
    assert.match(setupText, /skipSetupToDashboard/);
    assert.match(setupText, /setupCreateManagedDatabases/);
    assert.doesNotMatch(setupText, /Hosted mode|Hosted Dirong bot|Notion OAuth/);
    assert.match(notionText, /data-notion-action/);
    assert.match(managedDbText, /data-managed-db-action="check"/);
    assert.match(managedDbText, /data-managed-db-action="repair"/);
    assert.match(managedDbText, /remote_missing: 'dashboard\.db\.requiredFields\.issue\.remoteMissing'/);
    assert.match(managedDbText, /name_drift: 'dashboard\.db\.requiredFields\.issue\.nameDrift'/);
    assert.match(managedDbText, /relation_target_mismatch: 'dashboard\.db\.requiredFields\.issue\.relationTarget'/);
    assert.doesNotMatch(managedDbText, /technicalDetail/);
    assert.match(dashboardText, /fetch\('\/api\/state'/);
    assert.match(dashboardText, /renderProjectList/);
    assert.match(dashboardText, /createProjectFromSidebar/);
    assert.match(dashboardText, /switchProject/);
    assert.match(dashboardText, /projectActionStatus/);
    assert.match(dashboardText, /renderSettingsResetPanel/);
    assert.match(dashboardText, /current_project_connection/);
    assert.match(dashboardText, /openSetupWizard/);
    assert.doesNotMatch(notionText, /onclick=/);
    assert.doesNotMatch(notionText, /onchange=/);
    assert.doesNotMatch(notionText, /oninput=/);
    assert.doesNotMatch(managedDbText, /onclick=/);
    assert.doesNotMatch(managedDbText, /onchange=/);
    assert.doesNotMatch(managedDbText, /oninput=/);
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

test("DashboardServer stop force-closes active HTTP connections", async () => {
  const dashboard = new DashboardServer(
    makeDashboardConfig(),
    makeStore(),
    makeProducer(),
    {},
    { stopForceCloseMs: 5 },
  );
  await dashboard.start();
  const server = (dashboard as unknown as { server: Server | null }).server;
  assert.ok(server);
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const socket = await openIncompleteHttpConnection(address.port);

  try {
    const startedAt = Date.now();
    await dashboard.stop();
    const elapsedMs = Date.now() - startedAt;

    assert.ok(elapsedMs < 500, `dashboard stop waited too long: ${elapsedMs}ms`);
    assert.equal((dashboard as unknown as { server: Server | null }).server, null);
  } finally {
    socket.destroy();
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
    const unsigned = await fetch(`${fixture.baseUrl}/audio/chunk_audio_test/raw`);
    assert.equal(unsigned.status, 403);

    const rawUrl = await readSignedAudioUrl(fixture.baseUrl, "raw");
    const full = await fetch(new URL(rawUrl, fixture.baseUrl));
    assert.equal(full.status, 200);
    assert.equal(full.headers.get("content-length"), "10");
    assert.equal(Buffer.from(await full.arrayBuffer()).toString("utf8"), "0123456789");

    const range = await fetch(new URL(rawUrl, fixture.baseUrl), {
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
    const rawUrl = await readSignedAudioUrl(fixture.baseUrl, "raw");
    const response = await fetch(new URL(rawUrl, fixture.baseUrl), {
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
    const sttUrl = await readSignedAudioUrl(fixture.baseUrl, "stt");
    const response = await fetch(new URL(sttUrl, fixture.baseUrl));

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
    const response = await postJson(fixture.baseUrl, "/api/notion/send", {
      sessionId: "session-1",
      draftId: "draft-1",
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
    const response = await postJson(fixture.baseUrl, "/api/notion/retry", {
      sessionId: "session-1",
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
    databaseRole?: string;
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
    const response = await postJson(fixture.baseUrl, "/api/notion/properties", {
      targetDatabaseRole: "member",
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
    });
    const body = await response.json() as { ok: boolean; status: string };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.status, "done");
    assert.deepEqual(savedRules, [
      {
        databaseRole: "member",
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
    const response = await postJson(fixture.baseUrl, "/api/notion/schema/apply", {
      updateTypes: true,
      deleteExtra: true,
      confirmDeleteExtra: false,
    });
    const body = await response.json() as { ok: boolean; status: string };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.status, "done");
    assert.deepEqual(schemaApplies, [
      {
        createMissing: true,
        updateTypes: true,
        deleteExtra: false,
        confirmDeleteExtra: false,
      },
    ]);
  } finally {
    await fixture.close();
  }
});

test("DashboardServer Notion managed schema check and repair routes through dashboard source", async () => {
  const managedChecks: string[] = [];
  const managedRepairs: Array<{
    role: string;
    confirm: boolean;
    expectedPlanHash: string;
    operations?: readonly string[];
  }> = [];
  const fixture = await startDashboardFixture({
    notion: makeNotionSource([], [], [], managedChecks, managedRepairs),
  });
  try {
    const check = await postJson(
      fixture.baseUrl,
      "/api/notion/managed-schema/check",
      {},
    );
    const checkBody = await check.json() as { ok: boolean; status: string };
    const repair = await postJson(
      fixture.baseUrl,
      "/api/notion/managed-schema/repair",
      {
        role: "meeting",
        confirm: true,
        expectedPlanHash: "hash-1",
        operations: ["create_property:meeting.date"],
      },
    );
    const repairBody = await repair.json() as { ok: boolean; status: string };

    assert.equal(check.status, 200);
    assert.deepEqual(checkBody, { ok: true, status: "healthy", message: "checked", userAction: null, snapshot: null, plans: null });
    assert.equal(repair.status, 200);
    assert.equal(repairBody.ok, true);
    assert.equal(repairBody.status, "done");
    assert.deepEqual(managedChecks, ["check"]);
    assert.deepEqual(managedRepairs, [
      {
        role: "meeting",
        confirm: true,
        expectedPlanHash: "hash-1",
        operations: ["create_property:meeting.date"],
      },
    ]);
  } finally {
    await fixture.close();
  }
});

test("DashboardServer Notion member roster sync routes through dashboard source", async () => {
  const memberRosterSyncs: string[] = [];
  const fixture = await startDashboardFixture({
    notion: makeNotionSource([], [], [], [], [], memberRosterSyncs),
  });
  try {
    const response = await postJson(
      fixture.baseUrl,
      "/api/notion/member-roster/sync",
      {},
    );
    const body = await response.json() as {
      ok: boolean;
      status: string;
      messageKey: string;
      memberCount: number;
    };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.status, "done");
    assert.equal(body.messageKey, "dashboard.db.memberRoster.status.done");
    assert.equal(body.memberCount, 2);
    assert.deepEqual(memberRosterSyncs, ["sync"]);
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
  projects?: DashboardProjectsSource;
  settingsReset?: DashboardSettingsResetSource;
  setupStatus?: DashboardSetupStatusSource;
  setupWizard?: DashboardSetupWizardSource;
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
      ...(options.projects ? { projects: options.projects } : {}),
      ...(options.settingsReset ? { settingsReset: options.settingsReset } : {}),
      ...(options.setupStatus ? { setupStatus: options.setupStatus } : {}),
      ...(options.setupWizard ? { setupWizard: options.setupWizard } : {}),
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

async function openIncompleteHttpConnection(port: number): Promise<Socket> {
  const socket = connect({ host: "127.0.0.1", port });
  socket.on("error", () => {
    // The server may force-close this socket during shutdown.
  });
  await once(socket, "connect");
  socket.write("GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n");
  return socket;
}

async function postJson(
  baseUrl: string,
  pathname: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Dirong-Dashboard-Token": await readDashboardToken(baseUrl),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function readDashboardToken(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/`);
  const html = await response.text();
  const token = /window\.__DIRONG_DASHBOARD_TOKEN__="([^"]+)"/.exec(html)?.[1];
  assert.ok(token);
  return token;
}

function makeProjectsSource(options: {
  blockReason?: ActiveProjectSwitchBlockReason;
} = {}): DashboardProjectsSource {
  let activeProjectId = "project-ready";
  let projectCounter = 0;
  const projects: DirongProjectRow[] = [
    projectRow({
      id: "project-ready",
      name: "Ready",
      lifecycleStatus: "ready",
      guildId: "111111111111111111",
      notionTokenSecretRef: "notion.project.project-ready.token",
      notionParentPageUrl: "https://notion.so/ready",
    }),
    projectRow({
      id: "project-empty-draft",
      name: "Empty Draft",
      lifecycleStatus: "draft",
    }),
  ];

  return {
    listProjects: () => projects,
    getActiveProject: () =>
      projects.find((project) => project.id === activeProjectId) ?? null,
    createDraftProject: async (input = {}) => {
      const reusable = input.reuseEmptyDraft !== false
        ? projects.find((project) =>
          project.lifecycle_status === "draft" &&
          project.archived_at === null &&
          project.guild_id === null &&
          project.notion_token_secret_ref === null &&
          project.notion_parent_page_url === null)
        : null;
      const project = reusable
        ? Object.assign(reusable, {
            name: input.name ?? reusable.name,
            updated_at: input.name ? "2026-05-13T00:00:01.000Z" : reusable.updated_at,
          })
        : projectRow({
        id: `project-created-${++projectCounter}`,
        name: input.name ?? "Untitled Project",
        lifecycleStatus: "draft",
      });
      if (!reusable) {
        projects.push(project);
      }
      const switchResult = input.activate === false
        ? undefined
        : await switchProject(project.id);
      return {
        project,
        reused: Boolean(reusable),
        switchResult,
      };
    },
    switchActiveProject: switchProject,
  };

  async function switchProject(projectId: string) {
    const project = projects.find((entry) => entry.id === projectId);
    if (!project) {
      return {
        ok: false,
        status: "blocked",
        reason: "project_not_found",
        httpStatus: 404,
        message: `Project not found: ${projectId}`,
      } as const;
    }
    if (options.blockReason) {
      return {
        ok: false,
        status: "blocked",
        reason: options.blockReason,
        httpStatus: 409,
        message: "Switch blocked by test guard.",
      } as const;
    }
    activeProjectId = project.id;
    return {
      ok: true,
      status: "done",
      activeProject: project,
    } as const;
  }
}

function projectRow(input: {
  id: string;
  name: string;
  lifecycleStatus: DirongProjectRow["lifecycle_status"];
  guildId?: string | null;
  notionTokenSecretRef?: string | null;
  notionParentPageUrl?: string | null;
}): DirongProjectRow {
  return {
    id: input.id,
    name: input.name,
    lifecycle_status: input.lifecycleStatus,
    guild_id: input.guildId ?? null,
    guild_name: input.guildId ? `${input.name} Guild` : null,
    guild_icon_url: null,
    command_enabled: 1,
    notion_token_secret_ref: input.notionTokenSecretRef ?? null,
    notion_parent_page_url: input.notionParentPageUrl ?? null,
    notion_upload_mode: "manual",
    created_at: "2026-05-13T00:00:00.000Z",
    updated_at: "2026-05-13T00:00:00.000Z",
    archived_at: null,
  };
}

function makeSettingsResetSource(
  calls: string[] = [],
  blockReason?: "recording_active" | "notion_upload_in_flight" | "ai_cleanup_in_flight" | "reset_already_running",
): DashboardSettingsResetSource {
  return {
    reset: async (input) => {
      calls.push(input.mode);
      if (blockReason) {
        return {
          ok: false,
          status: "blocked",
          reason: blockReason,
          httpStatus: 409,
          message: "blocked by test",
        };
      }
      return {
        ok: true,
        status: "done",
        mode: input.mode,
        deleted: {
          settingsKeys: ["notion.tokenSecretRef"],
          secretRefs: ["notion.project.project-ready.token"],
          sqliteRows: {
            notionWorkspaceSettings: 0,
            notionManagedDatabases: 1,
            notionPropertyMappings: 0,
            notionMemberRosterEntries: 0,
            notionMemberRosterSyncs: 0,
            notionCustomPropertyRules: 0,
            notionWritesBlocked: 2,
            repairItemsIgnored: 0,
            projectsArchived: 1,
            projectsFreshDraft: 1,
          },
          blockedNotionWrites: 2,
        },
        runtimeEffects: [],
        setup: makeSetupStatusSource().getSnapshot(),
        activeProject: projectRow({
          id: "project-fresh",
          name: "Fresh",
          lifecycleStatus: "draft",
        }),
        activeProjectId: "project-fresh",
      };
    },
  };
}

async function readSignedAudioUrl(
  baseUrl: string,
  kind: "raw" | "stt",
): Promise<string> {
  const response = await fetch(`${baseUrl}/api/state`);
  const state = await response.json() as {
    recentChunks?: Array<{
      audioUrls?: Partial<Record<"raw" | "stt", string>>;
    }>;
  };
  const url = state.recentChunks?.[0]?.audioUrls?.[kind];
  assert.ok(url);
  return url;
}

function makeNotionSource(
  actions: Array<{
    sessionId: string | null;
    draftId: string | null;
    force: boolean;
  }> = [],
  savedRules: Array<{
    databaseRole?: string;
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
  managedChecks: string[] = [],
  managedRepairs: Array<{
    role: string;
    confirm: boolean;
    expectedPlanHash: string;
    operations?: readonly string[];
  }> = [],
  memberRosterSyncs: string[] = [],
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
      memberRoster: {
        dataSourceId: "member-data-source",
        status: "not_synced",
        syncedAt: null,
        memberCount: 0,
        roleCount: 0,
        warningCount: 0,
        warnings: [],
        lastError: null,
      },
      settings: {
        enabled: true,
        apiKey: "[REDACTED]",
        apiVersion: "2026-03-11",
        baseUrl: "https://api.notion.com",
        requestTimeoutMs: 30000,
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
        roles: {
          meeting: {
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
            rules: [],
            enabledCount: 0,
            promptPreview: "",
            message: "사용자 속성 0개 중 0개가 켜져 있습니다.",
            userAction: null,
          },
          member: {
            supportedTypes: ["rich_text", "select", "multi_select", "checkbox", "date"],
            requiredPropertyNames: ["디스코드 닉네임", "노션 연결"],
            rules: [],
            enabledCount: 0,
            promptPreview: "",
            message: "사용자 속성 0개 중 0개가 켜져 있습니다.",
            userAction: null,
          },
          task: {
            supportedTypes: ["rich_text", "select", "multi_select", "checkbox", "date"],
            requiredPropertyNames: ["작업", "회의록"],
            rules: [],
            enabledCount: 0,
            promptPreview: "",
            message: "사용자 속성 0개 중 0개가 켜져 있습니다.",
            userAction: null,
          },
        },
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
    syncCustomProperties: async (_input) => ({
      ok: true,
      status: "done",
      message: "synced",
      userAction: null,
      warnings: [],
      customProperties: makeNotionSource().getSnapshot().customProperties,
    }),
    syncMemberRoster: async () => {
      memberRosterSyncs.push("sync");
      return {
        ok: true,
        status: "done",
        messageKey: "dashboard.db.memberRoster.status.done",
        userActionKey: null,
        dataSourceId: "member-data-source",
        syncedAt: "2026-05-13T00:00:00.000Z",
        memberCount: 2,
        roleCount: 2,
        warnings: [],
      };
    },
    saveCustomPropertyRules: (input) => {
      savedRules.push(
        ...input.rules.map((rule) => ({
          ...rule,
          databaseRole: input.role,
        })),
      );
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
    checkManagedSchemaWithPlans: async () => {
      managedChecks.push("check");
      return {
        ok: true,
        status: "healthy",
        message: "checked",
        userAction: null,
        snapshot: null as never,
        plans: null as never,
      };
    },
    repairManagedSchema: async (input) => {
      managedRepairs.push(input);
      return {
        ok: true,
        status: "done",
        message: "repaired",
        userAction: null,
        plan: null as never,
        appliedOperationIds: [],
        registryUpdated: [],
        diff: null as never,
        snapshot: null as never,
      };
    },
  };
}

function makeSetupStatusSource(): DashboardSetupStatusSource {
  return {
    getSnapshot: () => ({
      generatedAt: "2026-05-10T00:00:00.000Z",
      locale: "ko",
      notionSchemaLocale: "ko",
      dashboardTheme: "system",
      defaults: {
        stt: {
          provider: DEFAULT_STT_SETTINGS.provider,
          language: DEFAULT_STT_SETTINGS.language,
          timeoutMs: DEFAULT_STT_SETTINGS.timeoutMs,
          openAiModel: DEFAULT_STT_SETTINGS.openai.model,
          localWhisper: {
            profile: DEFAULT_STT_SETTINGS.localWhisper.profile,
            model: DEFAULT_STT_SETTINGS.localWhisper.model,
            device: DEFAULT_STT_SETTINGS.localWhisper.device,
            computeType: DEFAULT_STT_SETTINGS.localWhisper.computeType,
          },
        },
        ai: DEFAULT_SETUP_AI_SETTINGS,
        retention: DEFAULT_RETENTION_SETTINGS,
        dashboard: {
          locale: DEFAULT_DASHBOARD_SETTINGS.locale,
          theme: DEFAULT_DASHBOARD_SETTINGS.theme,
          themes: DEFAULT_DASHBOARD_SETTINGS.themes,
        },
      },
      editableSettings: {
        stt: {
          provider: DEFAULT_STT_SETTINGS.provider,
          language: DEFAULT_STT_SETTINGS.language,
          timeoutMs: DEFAULT_STT_SETTINGS.timeoutMs,
          openAiModel: DEFAULT_STT_SETTINGS.openai.model,
          localWhisper: {
            profile: DEFAULT_STT_SETTINGS.localWhisper.profile,
            model: DEFAULT_STT_SETTINGS.localWhisper.model,
            device: DEFAULT_STT_SETTINGS.localWhisper.device,
            computeType: DEFAULT_STT_SETTINGS.localWhisper.computeType,
          },
        },
        ai: DEFAULT_SETUP_AI_SETTINGS,
        notion: {
          parentPageUrl: null,
          uploadMode: DEFAULT_NOTION_SETTINGS.uploadMode,
        },
        recording: {
          aloneFinalizeEnabled:
            DEFAULT_RECORDING_SETTINGS.productAloneFinalizeEnabled,
          aloneFinalizeGraceMs: DEFAULT_RECORDING_SETTINGS.aloneFinalizeGraceMs,
        },
      },
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
          messageKey: "setup.discord.status.notConfigured.message",
          message: "Discord 설정이 아직 없습니다.",
          userActionKey: "setup.discord.status.notConfigured.action",
          userAction: "Discord 설정을 완료해 주세요.",
          display: {
            title: "Discord 봇 연결이 아직 끝나지 않았어요",
            description: "디롱이가 사용할 봇 정보나 서버 선택이 빠져 있어서 Discord 기능을 잠시 멈췄습니다.",
            nextAction: "Discord 설정에서 application ID, bot token, 사용할 서버 선택을 완료해 주세요.",
            details: [],
          },
          missing: ["discord.applicationId"],
          applicationIdConfigured: false,
          guildAllowlistCount: 0,
        },
        recording: {
          status: "blocked",
          messageKey: "setup.recording.status.blocked.message",
          message: "녹음 시작은 아직 막혀 있습니다.",
          userActionKey: "setup.recording.status.blocked.action",
          userAction: "Discord와 STT 설정을 완료해 주세요.",
          missing: ["discord", "stt"],
        },
        stt: {
          status: "not_configured",
          messageKey: "setup.stt.status.notConfigured.message",
          message: "STT 설정이 아직 없습니다.",
          userActionKey: "setup.stt.status.notConfigured.action",
          userAction: "STT provider를 선택해 주세요.",
          missing: ["stt.provider"],
          provider: null,
          model: null,
        },
        ai: {
          status: "not_configured",
          messageKey: "setup.ai.status.notConfigured.message",
          message: "AI 설정이 아직 없습니다.",
          userActionKey: "setup.ai.status.notConfigured.action",
          userAction: "Claude provider를 선택해 주세요.",
          missing: ["ai.provider"],
          provider: null,
          mode: null,
          model: null,
        },
        notion: {
          status: "not_configured",
          messageKey: "setup.notion.status.notConfigured.message",
          message: "Notion 설정이 아직 없습니다.",
          userActionKey: "setup.notion.status.notConfigured.action",
          userAction: "Notion token과 노션 DB 관리 페이지 URL을 저장해 주세요.",
          missing: ["notion.token"],
          parentPageConfigured: false,
          managedRegistryReady: false,
        },
        dataRetention: {
          status: "ready",
          messageKey: "setup.dataRetention.status.ready.message",
          message: "기본 보관 정책이 적용되어 있습니다.",
          userActionKey: null,
          userAction: null,
          missing: [],
          deleteAudioAfterNotionUpload: true,
          textDraftRetentionDays: 30,
        },
      },
    }),
  };
}

function makeMutableSetupStatusSource(): DashboardSetupStatusSource {
  let locale: DirongLocale = "ko";
  let dashboardTheme: "system" | "light" | "dark" = "system";
  const base = makeSetupStatusSource();
  const snapshot = () => ({
    ...base.getSnapshot(),
    locale,
    notionSchemaLocale: locale,
    dashboardTheme,
  });

  return {
    getLocale: () => locale,
    getTheme: () => dashboardTheme,
    setLocale: (nextLocale) => {
      locale = nextLocale;
      return snapshot();
    },
    setTheme: (nextTheme) => {
      dashboardTheme = nextTheme;
      return snapshot();
    },
    getSnapshot: snapshot,
  };
}

function makeSetupWizardSource(calls: unknown[]): DashboardSetupWizardSource {
  const state = {
    ...makeSetupStatusSource().getSnapshot(),
    wizard: {
      currentStep: "discordApplication",
      completedStepCount: 1,
      totalStepCount: 10,
      inviteUrl: null,
      steps: [
        { id: "language", status: "ready" },
        { id: "discordApplication", status: "current" },
      ],
    },
  } as ReturnType<DashboardSetupWizardSource["getState"]>;

  const action = (body: unknown) => {
    calls.push(body);
    return {
      ok: true,
      status: "done" as const,
      messageKey: "setup.discord.applicationId.save.done.message" as const,
      message: "저장했습니다.",
      userActionKey: null,
      userAction: null,
      httpStatus: 200,
      setup: state,
    };
  };

  return {
    getState: () => state,
    getLocalWhisperInstallSnapshot: () => ({
      status: "running",
      stage: "checking_python",
      model: "small",
      message: "Checking Python environment.",
      detail: null,
      lastLog: null,
      startedAt: "2026-05-10T00:00:00.000Z",
      updatedAt: "2026-05-10T00:00:00.000Z",
      completedAt: null,
    }),
    startLocalWhisperInstall: (body) => ({
      ...action(body),
      status: "ready",
      httpStatus: 202,
      install: {
        status: "running",
        stage: "checking_python",
        model: "small",
        message: "Checking Python environment.",
        detail: null,
        lastLog: null,
        startedAt: "2026-05-10T00:00:00.000Z",
        updatedAt: "2026-05-10T00:00:00.000Z",
        completedAt: null,
      },
    }),
    testAndSaveOpenAiSttSettings: async (body) => action(body),
    saveDiscordApplicationId: action,
    saveDiscordBotToken: action,
    testDiscordConnection: async () => action({}),
    listDiscordGuilds: async () => ({ ...action({}), guilds: [] }),
    saveDiscordGuildAllowlist: async (body) => action(body),
    saveSttSettings: action,
    saveClaudeSettings: action,
    testClaudeConnection: async () => action({}),
    saveNotionToken: action,
    saveNotionParentPageUrl: action,
    verifyNotionParentPage: async () => action({}),
    createManagedDatabases: async () => action({}),
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
      recentChunks: audio
        ? [
            {
              id: audio.chunkId,
              status: "finalized",
              raw_byte_size: audio.raw ? 1 : 0,
              stt_audio_path: audio.stt?.path ?? null,
              stt_byte_size: audio.stt ? 1 : 0,
            },
          ]
        : [],
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
