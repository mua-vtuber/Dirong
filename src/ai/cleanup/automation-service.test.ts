import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AiProviderLifecycleService } from "./provider-lifecycle-service.js";
import { wrapAiCleanupProviderWithLifecycle } from "./provider-lifecycle.js";
import {
  AiCleanupAutomationService,
  formatAiCleanupAutomationForStatus,
} from "./automation-service.js";
import type { AppLocaleResolver } from "../../i18n/app-locale.js";
import { FakeAiCleanupProvider } from "./fake-provider.js";
import { AiCleanupProviderError } from "./provider.js";
import { PHASE4_AI_CLEANUP_PROMPT_VERSION } from "./prompts.js";
import { buildPhase4TimelineInput } from "./timeline-input.js";
import type { AiCleanupSessionContext } from "./runner.js";
import type {
  AiCleanupProvider,
  AiCleanupProviderInput,
  AiCleanupProviderOptions,
  AiCleanupProviderResult,
} from "./provider.js";
import { DirongDatabase } from "../../storage/sqlite.js";
import { SessionStore } from "../../storage/session-store.js";

test("AiCleanupAutomationService waits while STT queued jobs remain", async () => {
  const fixture = createSessionFixture();
  try {
    addQueuedSttChunk(fixture, 1);
    finalizeSession(fixture);
    const provider = new CountingFakeAiCleanupProvider();
    const service = await createReadyAutomationService(fixture, provider);

    const snapshot = await service.runOnce();

    assert.equal(snapshot.status, "waiting_for_stt");
    assert.equal(snapshot.stt?.sttQueuedCount, 1);
    assert.deepEqual(fixture.countAiRows(), { jobs: 0, drafts: 0 });
    assert.equal(provider.generateCalls, 0);
  } finally {
    fixture.close();
  }
});

test("AiCleanupAutomationService localizes runtime snapshot with app locale", async () => {
  const fixture = createSessionFixture();
  try {
    addQueuedSttChunk(fixture, 1);
    finalizeSession(fixture);
    const provider = new CountingFakeAiCleanupProvider();
    const service = await createReadyAutomationService(fixture, provider, {
      localeResolver: () => "en",
    });

    const snapshot = await service.runOnce();

    assert.equal(snapshot.status, "waiting_for_stt");
    assert.equal(snapshot.message, "Waiting for STT to finish");
    assert.equal(snapshot.display?.title, "Waiting for STT to finish");
    assert.equal(snapshot.provider, provider.providerName);
  } finally {
    fixture.close();
  }
});

test("AiCleanupAutomationService passes app locale into generated meeting notes", async () => {
  const fixture = createSessionFixture();
  try {
    addCompletedRealSttChunk(fixture, 1, "Friday까지 회의록을 정리하겠습니다.");
    finalizeSession(fixture);
    const provider = new CountingFakeAiCleanupProvider();
    const service = await createReadyAutomationService(fixture, provider, {
      localeResolver: () => "en",
    });

    const snapshot = await service.runOnce();

    assert.equal(snapshot.status, "done");
    assert.equal(provider.lastInput?.language, "en");
    assert.deepEqual(fixture.countAiRows(), { jobs: 1, drafts: 1 });
  } finally {
    fixture.close();
  }
});

test("AiCleanupAutomationService hashes and prompts with the session project context", async () => {
  const fixture = createSessionFixture({ projectId: "project-alpha" });
  try {
    addCompletedRealSttChunk(fixture, 1, "Alpha 프로젝트 회의록을 정리합니다.");
    finalizeSession(fixture);
    const provider = new CountingFakeAiCleanupProvider();
    const service = await createReadyAutomationService(fixture, provider, {
      customNotionPropertyPrompt: (context) =>
        context.projectId === "project-alpha"
          ? "Project Alpha cleanup rule: use Alpha fields."
          : "Project Beta cleanup rule: use Beta fields.",
      memberRosterPrompt: (context) =>
        context.projectId === "project-alpha"
          ? "Known member roles for assignment hints:\n- Alpha Lead: roles=Owner"
          : "Known member roles for assignment hints:\n- Beta Lead: roles=Owner",
    });

    const snapshot = await service.runOnce();

    assert.equal(snapshot.status, "done");
    assert.match(provider.lastUserPrompt ?? "", /Project Alpha cleanup rule/);
    assert.match(provider.lastUserPrompt ?? "", /Alpha Lead: roles=Owner/);
    assert.doesNotMatch(
      provider.lastUserPrompt ?? "",
      /Project Beta cleanup rule|Beta Lead/,
    );
    assert.equal(snapshot.job?.inputHash, provider.lastInput?.inputHash);
  } finally {
    fixture.close();
  }
});

test("AiCleanupAutomationService requeues expired STT processing leases before waiting", async () => {
  const fixture = createSessionFixture();
  try {
    addProcessingSttChunk(fixture, 1);
    fixture.database.db.prepare(
      `UPDATE stt_jobs
       SET locked_by = 'stale-stt-worker',
           locked_until = '2000-01-01T00:00:00.000Z'
       WHERE status = 'processing'`,
    ).run();
    finalizeSession(fixture);
    const provider = new CountingFakeAiCleanupProvider();
    const service = await createReadyAutomationService(fixture, provider);

    const snapshot = await service.runOnce();

    assert.equal(snapshot.status, "waiting_for_stt");
    assert.equal(snapshot.repairedExpiredSttLeases, 1);
    assert.equal(snapshot.stt?.sttQueuedCount, 1);
    assert.equal(snapshot.stt?.sttProcessingCount, 0);
    assert.equal(readOnlySttJobStatus(fixture), "queued");
    assert.equal(countExpiredLeaseRepairItems(fixture), 1);
    assert.equal(provider.generateCalls, 0);
  } finally {
    fixture.close();
  }
});

test("AiCleanupAutomationService skips an STT-waiting session and runs a later terminal session", async () => {
  const fixture = createSessionFixture();
  try {
    addQueuedSttChunk(fixture, 1);
    finalizeSession(fixture);
    setFinalizedAt(fixture, fixture.sessionId, "2026-05-06T00:00:00.000Z");

    const readyFixture = createAdditionalSession(
      fixture,
      "meeting_ai_auto_ready_after_waiting",
    );
    addCompletedRealSttChunk(
      readyFixture,
      1,
      "뒤 세션은 바로 회의록을 만들어야 합니다.",
    );
    finalizeSession(readyFixture);
    setFinalizedAt(
      fixture,
      readyFixture.sessionId,
      "2026-05-06T00:00:01.000Z",
    );

    const provider = new CountingFakeAiCleanupProvider();
    const service = await createReadyAutomationService(fixture, provider);

    const snapshot = await service.runOnce();

    assert.equal(snapshot.status, "done");
    assert.equal(snapshot.sessionId, readyFixture.sessionId);
    assert.deepEqual(fixture.countAiRows(), { jobs: 1, drafts: 1 });
    assert.equal(provider.generateCalls, 1);
  } finally {
    fixture.close();
  }
});

test("AiCleanupAutomationService prioritizes ready sessions over old STT waiting sessions with a small batch limit", async () => {
  const fixture = createSessionFixture();
  try {
    addQueuedSttChunk(fixture, 1);
    finalizeSession(fixture);
    setFinalizedAt(fixture, fixture.sessionId, "2026-05-06T00:00:00.000Z");

    const processingFixture = createAdditionalSession(
      fixture,
      "meeting_ai_auto_old_stt_processing",
    );
    addProcessingSttChunk(processingFixture, 1);
    finalizeSession(processingFixture);
    setFinalizedAt(
      fixture,
      processingFixture.sessionId,
      "2026-05-06T00:00:01.000Z",
    );

    const readyFixture = createAdditionalSession(
      fixture,
      "meeting_ai_auto_ready_after_stt_waiting_limit_one",
    );
    addCompletedRealSttChunk(
      readyFixture,
      1,
      "batch limit이 1이어도 이 세션을 먼저 처리해야 합니다.",
    );
    finalizeSession(readyFixture);
    setFinalizedAt(
      fixture,
      readyFixture.sessionId,
      "2026-05-06T00:00:02.000Z",
    );

    const provider = new CountingFakeAiCleanupProvider();
    const service = await createReadyAutomationService(fixture, provider, {
      sessionBatchLimit: 1,
    });

    const snapshot = await service.runOnce();

    assert.equal(snapshot.status, "done");
    assert.equal(snapshot.sessionId, readyFixture.sessionId);
    assert.deepEqual(fixture.countAiRows(), { jobs: 1, drafts: 1 });
    assert.equal(provider.generateCalls, 1);
  } finally {
    fixture.close();
  }
});

test("AiCleanupAutomationService runs Phase 4 after finalized STT terminal state", async () => {
  const fixture = createSessionFixture();
  try {
    addCompletedRealSttChunk(fixture, 1, "금요일까지 회의록을 정리하겠습니다.");
    finalizeSession(fixture);
    const provider = new CountingFakeAiCleanupProvider();
    const service = await createReadyAutomationService(fixture, provider);

    const snapshot = await service.runOnce();

    assert.equal(snapshot.status, "done");
    assert.equal(snapshot.stt?.isTerminal, true);
    assert.equal(snapshot.stt?.realTranscriptEntryCount, 1);
    assert.equal(snapshot.job?.status, "done");
    assert.deepEqual(fixture.countAiRows(), { jobs: 1, drafts: 1 });
    assert.equal(provider.generateCalls, 1);
  } finally {
    fixture.close();
  }
});

test("AiCleanupAutomationService exposes progress metadata without transcript text", async () => {
  const fixture = createSessionFixture();
  try {
    const provider = new CountingFakeAiCleanupProvider();
    addCompletedRealSttChunk(
      fixture,
      1,
      "SECRET_PROGRESS_TRANSCRIPT 회의록을 정리합니다.",
    );
    finalizeSession(fixture);
    const service = await createReadyAutomationService(fixture, provider);

    const snapshot = await service.runOnce();

    assert.equal(snapshot.status, "done");
    assert.equal(snapshot.progress?.phase, "completed");
    assert.equal(snapshot.progress?.jobId, snapshot.job?.id);
    assert.doesNotMatch(
      JSON.stringify(snapshot.progress),
      /SECRET_PROGRESS_TRANSCRIPT/,
    );
  } finally {
    fixture.close();
  }
});

test("AiCleanupAutomationService skips a queued AI job whose retry time is in the future", async () => {
  const fixture = createSessionFixture();
  try {
    const provider = new CountingFakeAiCleanupProvider();

    addCompletedRealSttChunk(
      fixture,
      1,
      "앞 세션은 AI cleanup 재시도 시간이 아직 오지 않았습니다.",
    );
    finalizeSession(fixture);
    setFinalizedAt(fixture, fixture.sessionId, "2026-05-06T00:00:00.000Z");
    const backoffJob = createQueuedAiCleanupJob(fixture, provider);
    fixture.database.db.prepare(
      "UPDATE ai_cleanup_jobs SET next_attempt_at = ? WHERE id = ?",
    ).run("2999-01-01T00:00:00.000Z", backoffJob.id);

    const readyFixture = createAdditionalSession(
      fixture,
      "meeting_ai_auto_ready_after_backoff",
    );
    addCompletedRealSttChunk(
      readyFixture,
      1,
      "뒤 세션은 AI cleanup을 실행할 수 있습니다.",
    );
    finalizeSession(readyFixture);
    setFinalizedAt(
      fixture,
      readyFixture.sessionId,
      "2026-05-06T00:00:01.000Z",
    );

    const service = await createReadyAutomationService(fixture, provider);

    const snapshot = await service.runOnce();
    const unchangedBackoffJob = fixture.store.getAiCleanupJob(backoffJob.id);

    assert.equal(snapshot.status, "done");
    assert.equal(snapshot.sessionId, readyFixture.sessionId);
    assert.equal(unchangedBackoffJob?.attempts, 0);
    assert.equal(provider.generateCalls, 1);
  } finally {
    fixture.close();
  }
});

test("AiCleanupAutomationService prioritizes ready sessions over old AI backoff jobs with a small batch limit", async () => {
  const fixture = createSessionFixture();
  try {
    const provider = new CountingFakeAiCleanupProvider();

    addCompletedRealSttChunk(
      fixture,
      1,
      "앞 세션은 오래된 AI cleanup backoff 상태입니다.",
    );
    finalizeSession(fixture);
    setFinalizedAt(fixture, fixture.sessionId, "2026-05-06T00:00:00.000Z");
    const backoffJob = createQueuedAiCleanupJob(fixture, provider);
    fixture.database.db.prepare(
      "UPDATE ai_cleanup_jobs SET next_attempt_at = ? WHERE id = ?",
    ).run("2999-01-01T00:00:00.000Z", backoffJob.id);

    const readyFixture = createAdditionalSession(
      fixture,
      "meeting_ai_auto_ready_after_backoff_limit_one",
    );
    addCompletedRealSttChunk(
      readyFixture,
      1,
      "batch limit이 1이어도 backoff 세션보다 먼저 실행됩니다.",
    );
    finalizeSession(readyFixture);
    setFinalizedAt(
      fixture,
      readyFixture.sessionId,
      "2026-05-06T00:00:01.000Z",
    );

    const service = await createReadyAutomationService(fixture, provider, {
      sessionBatchLimit: 1,
    });

    const snapshot = await service.runOnce();
    const unchangedBackoffJob = fixture.store.getAiCleanupJob(backoffJob.id);

    assert.equal(snapshot.status, "done");
    assert.equal(snapshot.sessionId, readyFixture.sessionId);
    assert.equal(unchangedBackoffJob?.attempts, 0);
    assert.equal(provider.generateCalls, 1);
  } finally {
    fixture.close();
  }
});

test("AiCleanupAutomationService records empty timeline block without provider generate for fake-only STT", async () => {
  const fixture = createSessionFixture();
  try {
    addCompletedFakeSttChunk(fixture, 1, "[FAKE STT] 테스트 transcript입니다.");
    finalizeSession(fixture);
    const provider = new CountingFakeAiCleanupProvider();
    const service = await createReadyAutomationService(fixture, provider);

    const snapshot = await service.runOnce();

    assert.equal(snapshot.status, "blocked");
    assert.equal(snapshot.job?.status, "blocked");
    assert.equal(snapshot.job?.failureKind, "empty_timeline");
    assert.equal(snapshot.stt?.shouldRecordEmptyTimelineBlock, true);
    assert.deepEqual(fixture.countAiRows(), { jobs: 1, drafts: 0 });
    assert.equal(provider.generateCalls, 0);
  } finally {
    fixture.close();
  }
});

test("AiCleanupAutomationService records empty timeline block without provider generate for no-speech-only STT", async () => {
  const fixture = createSessionFixture();
  try {
    addCompletedNoSpeechSttChunk(fixture, 1);
    finalizeSession(fixture);
    const provider = new CountingFakeAiCleanupProvider();
    const service = await createReadyAutomationService(fixture, provider);

    const snapshot = await service.runOnce();

    assert.equal(snapshot.status, "blocked");
    assert.equal(snapshot.job?.status, "blocked");
    assert.equal(snapshot.job?.failureKind, "empty_timeline");
    assert.equal(snapshot.stt?.shouldRecordEmptyTimelineBlock, true);
    assert.deepEqual(fixture.countAiRows(), { jobs: 1, drafts: 0 });
    assert.equal(provider.generateCalls, 0);
  } finally {
    fixture.close();
  }
});

test("AiCleanupAutomationService can run when some STT jobs failed but real transcript exists", async () => {
  const fixture = createSessionFixture();
  try {
    addCompletedRealSttChunk(fixture, 1, "실제 발화가 하나 있습니다.");
    addFailedSttChunk(fixture, 2);
    finalizeSession(fixture);
    const provider = new CountingFakeAiCleanupProvider();
    const service = await createReadyAutomationService(fixture, provider);

    const snapshot = await service.runOnce();

    assert.equal(snapshot.status, "done");
    assert.equal(snapshot.stt?.sttFailedCount, 1);
    assert.equal(snapshot.stt?.realTranscriptEntryCount, 1);
    assert.equal(snapshot.warnings.some((warning) => warning.includes("STT 실패")), true);
    assert.deepEqual(fixture.countAiRows(), { jobs: 1, drafts: 1 });
    assert.equal(provider.generateCalls, 1);
  } finally {
    fixture.close();
  }
});

test("AiCleanupAutomationService does not duplicate an existing done draft", async () => {
  const fixture = createSessionFixture();
  try {
    addCompletedRealSttChunk(fixture, 1, "이미 처리된 transcript입니다.");
    finalizeSession(fixture);
    const firstProvider = new CountingFakeAiCleanupProvider();
    const firstService = await createReadyAutomationService(fixture, firstProvider);
    const first = await firstService.runOnce();
    assert.equal(first.status, "done");

    const secondProvider = new CountingFakeAiCleanupProvider();
    const secondService = await createReadyAutomationService(fixture, secondProvider);
    const second = await secondService.runOnce();

    assert.equal(second.status, "already_done");
    assert.deepEqual(fixture.countAiRows(), { jobs: 1, drafts: 1 });
    assert.equal(secondProvider.generateCalls, 0);
  } finally {
    fixture.close();
  }
});

test("AiCleanupAutomationService waits for provider readiness without creating a job", async () => {
  const fixture = createSessionFixture();
  try {
    addCompletedRealSttChunk(fixture, 1, "AI provider가 준비되면 처리됩니다.");
    finalizeSession(fixture);
    const provider = new MissingProvider();
    const lifecycle = new AiProviderLifecycleService(
      wrapAiCleanupProviderWithLifecycle(provider),
      { prepareTimeoutMs: 100 },
    );
    await lifecycle.startPrepareInBackground();
    const service = createAutomationService(fixture, provider, lifecycle);

    const snapshot = await service.runOnce();

    assert.equal(snapshot.status, "waiting_for_ai_provider");
    assert.equal(snapshot.sessionId, null);
    assert.deepEqual(fixture.countAiRows(), { jobs: 0, drafts: 0 });
    assert.equal(provider.generateCalls, 0);
  } finally {
    fixture.close();
  }
});

test("AiCleanupAutomationService rediscovers finalized sessions after service restart", async () => {
  const fixture = createSessionFixture();
  try {
    addCompletedRealSttChunk(fixture, 1, "앱 재시작 후에도 찾아야 하는 transcript입니다.");
    finalizeSession(fixture);
    const provider = new CountingFakeAiCleanupProvider();
    const lifecycle = await createReadyLifecycle(provider);
    const restartedService = createAutomationService(fixture, provider, lifecycle);

    const snapshot = await restartedService.runOnce();

    assert.equal(snapshot.status, "done");
    assert.deepEqual(fixture.countAiRows(), { jobs: 1, drafts: 1 });
  } finally {
    fixture.close();
  }
});

test("AiCleanupAutomationService stop publishes stopped snapshot", async () => {
  const fixture = createSessionFixture();
  try {
    const provider = new CountingFakeAiCleanupProvider();
    const service = await createReadyAutomationService(fixture, provider);

    await service.stop();

    assert.equal(service.getSnapshot().status, "stopped");
  } finally {
    fixture.close();
  }
});

test("formatAiCleanupAutomationForStatus renders concise non-developer status", () => {
  assert.match(
    formatAiCleanupAutomationForStatus({
      enabled: true,
      status: "waiting_for_stt",
      provider: "claude-cli",
      model: "haiku",
      checkedAt: "2026-05-06T00:00:00.000Z",
      sessionId: "meeting_1",
      message: "STT 완료 대기 중",
      userAction: null,
      technicalDetail: null,
      stt: {
        sessionId: "meeting_1",
        sessionStatus: "finalized",
        openChunkCount: 0,
        sttQueuedCount: 1,
        sttProcessingCount: 0,
        sttDoneCount: 0,
        sttFailedCount: 0,
        sttFailedMissingFileCount: 0,
        sttOtherNonTerminalCount: 0,
        chunksMissingSttJobCount: 0,
        chunksWithTranscodeFailedCount: 0,
        chunksMissingSttAudioCount: 0,
        realTranscriptEntryCount: 0,
        isTerminal: false,
        canGenerateDraft: false,
        shouldRecordEmptyTimelineBlock: false,
        canInvokeRunner: false,
        warnings: [],
      },
      job: null,
      lastRunStatus: null,
      inFlightSessionIds: [],
      repairedExpiredJobs: { requeued: 0, failed: 0 },
      repairedExpiredSttLeases: 0,
      warnings: [],
      progress: null,
    }),
    /AI cleanup 자동화: STT 완료 대기 중/,
  );
});

type AutomationFixture = {
  dir: string;
  database: DirongDatabase;
  store: SessionStore;
  sessionId: string;
  close: () => void;
  countAiRows: () => { jobs: number; drafts: number };
};

function createSessionFixture(
  options: { projectId?: string | null } = {},
): AutomationFixture {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-ai-auto-"));
  const database = new DirongDatabase(path.join(dir, "dirong.sqlite"), 1000);
  const store = new SessionStore(database);
  const sessionId = "meeting_ai_auto_test";
  if (options.projectId) {
    insertProject(database, options.projectId, "Project Alpha");
  }

  store.createSession({
    id: sessionId,
    projectId: options.projectId,
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

  return {
    dir,
    database,
    store,
    sessionId,
    close: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
    countAiRows: () => {
      const row = database.db.prepare(
        `SELECT
           (SELECT COUNT(*) FROM ai_cleanup_jobs) AS jobs,
           (SELECT COUNT(*) FROM meeting_notes_drafts) AS drafts`,
      ).get() as { jobs: number; drafts: number };
      return { jobs: row.jobs, drafts: row.drafts };
    },
  };
}

function createAdditionalSession(
  fixture: AutomationFixture,
  sessionId: string,
  options: { projectId?: string | null } = {},
): AutomationFixture {
  if (options.projectId) {
    insertProject(fixture.database, options.projectId, sessionId);
  }
  fixture.store.createSession({
    id: sessionId,
    projectId: options.projectId,
    guildId: "guild",
    guildName: "Guild",
    textChannelId: "text",
    voiceChannelId: "voice",
    voiceChannelName: "Voice",
    startedByUserId: "starter",
    startedByDisplayName: "Taniar",
    dataDir: path.join(fixture.dir, sessionId),
  });
  fixture.store.upsertSpeaker({
    sessionId,
    userId: "speaker",
    displayNameSnapshot: "Taniar",
    isBot: false,
    seenAtMs: 0,
  });

  return {
    ...fixture,
    sessionId,
  };
}

function createQueuedAiCleanupJob(
  fixture: AutomationFixture,
  provider: AiCleanupProvider,
) {
  const timelineInput = buildPhase4TimelineInput(fixture.store, {
    sessionId: fixture.sessionId,
    includeFakeStt: false,
  });
  return fixture.store.getOrCreateAiCleanupJob({
    id: `ai_backoff_${fixture.sessionId}`,
    sessionId: fixture.sessionId,
    provider: provider.providerName,
    model: provider.modelName,
    command: null,
    promptVersion: PHASE4_AI_CLEANUP_PROMPT_VERSION,
    inputContractVersion: timelineInput.timeline.contractVersion,
    inputHash: timelineInput.inputHash,
    inputEntryCount: timelineInput.timeline.entries.length,
    inputTimelineJsonPath: null,
    inputTimelineMarkdownPath: null,
    maxAttempts: 3,
  });
}

function addCompletedRealSttChunk(
  fixture: AutomationFixture,
  index: number,
  text: string,
): void {
  addQueuedSttChunk(fixture, index);
  const job = fixture.store.claimNextSttJob({
    workerId: "ai-auto-test-stt",
    leaseMs: 60000,
    sessionId: fixture.sessionId,
  });
  assert.ok(job);
  fixture.store.completeSttJob({
    job,
    text,
    source: "real",
    provider: "local-whisper",
    model: "small",
    inputAudioSha256: `stt-${index}`,
  });
}

function addCompletedFakeSttChunk(
  fixture: AutomationFixture,
  index: number,
  text: string,
): void {
  addQueuedSttChunk(fixture, index);
  const job = fixture.store.claimNextSttJob({
    workerId: "ai-auto-test-stt",
    leaseMs: 60000,
    sessionId: fixture.sessionId,
  });
  assert.ok(job);
  fixture.store.completeFakeSttJob({ job, text });
}

function addCompletedNoSpeechSttChunk(
  fixture: AutomationFixture,
  index: number,
): void {
  addQueuedSttChunk(fixture, index);
  const job = fixture.store.claimNextSttJob({
    workerId: "ai-auto-test-stt",
    leaseMs: 60000,
    sessionId: fixture.sessionId,
  });
  assert.ok(job);
  fixture.store.completeSttJob({
    job,
    text: "",
    source: "real",
    provider: "local-whisper",
    model: "small",
    inputAudioSha256: `stt-${index}`,
  });
}

function addProcessingSttChunk(
  fixture: AutomationFixture,
  index: number,
): void {
  addQueuedSttChunk(fixture, index);
  const job = fixture.store.claimNextSttJob({
    workerId: "ai-auto-test-stt",
    leaseMs: 60000,
    sessionId: fixture.sessionId,
  });
  assert.ok(job);
}

function addFailedSttChunk(fixture: AutomationFixture, index: number): void {
  addQueuedSttChunk(fixture, index, { maxAttempts: 1 });
  const job = fixture.store.claimNextSttJob({
    workerId: "ai-auto-test-stt",
    leaseMs: 60000,
    sessionId: fixture.sessionId,
  });
  assert.ok(job);
  fixture.store.failProcessingSttJob({
    jobId: job.id,
    error: "deterministic STT failure",
  });
}

function addQueuedSttChunk(
  fixture: AutomationFixture,
  index: number,
  options: { maxAttempts?: number } = {},
): void {
  const chunkId = `${fixture.sessionId}_${String(index).padStart(6, "0")}_speaker`;
  fixture.store.createChunkWriting({
    chunkId,
    sessionId: fixture.sessionId,
    chunkIndex: index,
    userId: "speaker",
    displayNameSnapshot: "Taniar",
    startedAtMs: index * 1000,
    rawAudioPath: path.join(fixture.dir, `${chunkId}.ogg`),
  });
  fixture.store.finalizeRawChunk({
    chunkId,
    endedAtMs: index * 1000 + 500,
    durationMs: 500,
    rawByteSize: 10,
    rawSha256: `raw-${index}`,
    closeReason: "test",
    pipelineError: null,
  });
  fixture.store.completeChunkTranscodeAndQueueJob({
    chunkId,
    sttAudioPath: path.join(fixture.dir, `${chunkId}.webm`),
    sttAudioFormat: "webm",
    sttByteSize: 10,
    sttSha256: `stt-${index}`,
    maxAttempts: options.maxAttempts ?? 3,
  });
}

function finalizeSession(fixture: AutomationFixture): void {
  fixture.store.stopSession({
    sessionId: fixture.sessionId,
    stoppedByUserId: "starter",
    stoppedByDisplayName: "Taniar",
    status: "finalized",
  });
}

function setFinalizedAt(
  fixture: AutomationFixture,
  sessionId: string,
  finalizedAt: string,
): void {
  fixture.database.db.prepare(
    "UPDATE sessions SET finalized_at = ?, updated_at = ? WHERE id = ?",
  ).run(finalizedAt, finalizedAt, sessionId);
}

function readOnlySttJobStatus(fixture: AutomationFixture): string | null {
  const row = fixture.database.db.prepare(
    "SELECT status FROM stt_jobs LIMIT 1",
  ).get() as { status: string } | undefined;
  return row?.status ?? null;
}

function countExpiredLeaseRepairItems(fixture: AutomationFixture): number {
  const row = fixture.database.db.prepare(
    `SELECT COUNT(*) AS count
     FROM repair_items
     WHERE item_type = 'expired_processing_lease_requeued'`,
  ).get() as { count: number };
  return row.count;
}

async function createReadyAutomationService(
  fixture: AutomationFixture,
  provider: AiCleanupProvider,
  options: AutomationServiceTestOptions = {},
): Promise<AiCleanupAutomationService> {
  const lifecycle = await createReadyLifecycle(provider);
  return createAutomationService(fixture, provider, lifecycle, options);
}

async function createReadyLifecycle(
  provider: AiCleanupProvider,
): Promise<AiProviderLifecycleService> {
  const lifecycle = new AiProviderLifecycleService(
    wrapAiCleanupProviderWithLifecycle(provider),
    { prepareTimeoutMs: 100 },
  );
  const readiness = await lifecycle.startPrepareInBackground();
  assert.equal(readiness.status, "ready");
  return lifecycle;
}

function createAutomationService(
  fixture: AutomationFixture,
  provider: AiCleanupProvider,
  lifecycle: AiProviderLifecycleService,
  options: AutomationServiceTestOptions = {},
): AiCleanupAutomationService {
  return new AiCleanupAutomationService(fixture.store, {
    enabled: true,
    provider,
    lifecycle,
    pollIntervalMs: 1000,
    sessionBatchLimit: options.sessionBatchLimit ?? 3,
    readinessRetryMs: 1000,
    runner: {
      workerId: "ai-auto-test",
      leaseMs: 60000,
      maxAttempts: 1,
      maxInputChars: 120000,
      timeoutMs: 1000,
      maxOutputBytes: 1024 * 1024,
      customNotionPropertyPrompt: options.customNotionPropertyPrompt,
      memberRosterPrompt: options.memberRosterPrompt,
      backup: () => [],
    },
    localeResolver: options.localeResolver,
  });
}

type AutomationServiceTestOptions = {
  sessionBatchLimit?: number;
  localeResolver?: AppLocaleResolver;
  customNotionPropertyPrompt?: (context: AiCleanupSessionContext) => string;
  memberRosterPrompt?: (context: AiCleanupSessionContext) => string;
};

function insertProject(
  database: DirongDatabase,
  projectId: string,
  name: string,
): void {
  const now = new Date().toISOString();
  database.db.prepare(
    `INSERT INTO dirong_projects (
       id, name, lifecycle_status, guild_id, guild_name, command_enabled,
       notion_upload_mode, created_at, updated_at
     ) VALUES (?, ?, 'ready', 'guild', 'Guild', 1, 'manual', ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  ).run(projectId, name, now, now);
}

class CountingFakeAiCleanupProvider extends FakeAiCleanupProvider {
  preflightCalls = 0;
  generateCalls = 0;
  lastInput: AiCleanupProviderInput | null = null;
  lastUserPrompt: string | null = null;

  override async preflight(): Promise<void> {
    this.preflightCalls += 1;
  }

  override async generate(
    input: AiCleanupProviderInput,
    options: AiCleanupProviderOptions,
  ): Promise<AiCleanupProviderResult> {
    this.generateCalls += 1;
    this.lastInput = input;
    this.lastUserPrompt = options.userPrompt;
    return super.generate(input, options);
  }
}

class MissingProvider extends CountingFakeAiCleanupProvider {
  override readonly providerName = "claude-cli";
  override readonly modelName = "haiku";

  override async preflight(): Promise<void> {
    this.preflightCalls += 1;
    throw new AiCleanupProviderError(
      "provider_not_found",
      "claude command missing",
    );
  }

  override async generate(
    _input: AiCleanupProviderInput,
    _options: AiCleanupProviderOptions,
  ): Promise<AiCleanupProviderResult> {
    this.generateCalls += 1;
    throw new Error("generate should not be called");
  }
}
