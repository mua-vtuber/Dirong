import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PHASE4_AI_CLEANUP_PROMPT_VERSION } from "../ai/cleanup/prompts.js";
import { buildPhase4TimelineInput } from "../ai/cleanup/timeline-input.js";
import { SessionStore } from "./session-store.js";
import { DirongDatabase } from "./sqlite.js";

test("getAiCleanupSttTerminalSnapshot waits for queued STT jobs", () => {
  const fixture = createFixture();
  try {
    addQueuedSttChunk(fixture, 1);
    finalizeSession(fixture);

    const snapshot = fixture.store.getAiCleanupSttTerminalSnapshot(fixture.sessionId);

    assert.equal(snapshot?.isTerminal, false);
    assert.equal(snapshot?.canInvokeRunner, false);
    assert.equal(snapshot?.sttQueuedCount, 1);
  } finally {
    fixture.close();
  }
});

test("getAiCleanupSttTerminalSnapshot allows empty timeline block after fake/no_speech terminal state", () => {
  const fixture = createFixture();
  try {
    addNoSpeechChunk(fixture, 1);
    finalizeSession(fixture);

    const snapshot = fixture.store.getAiCleanupSttTerminalSnapshot(fixture.sessionId);

    assert.equal(snapshot?.isTerminal, true);
    assert.equal(snapshot?.realTranscriptEntryCount, 0);
    assert.equal(snapshot?.shouldRecordEmptyTimelineBlock, true);
    assert.equal(snapshot?.canInvokeRunner, true);
  } finally {
    fixture.close();
  }
});

test("getAiCleanupSttTerminalSnapshot reports failed/missing chunk warnings while allowing real transcript", () => {
  const fixture = createFixture();
  try {
    addCompletedRealSttChunk(fixture, 1);
    addFailedSttChunk(fixture, 2);
    addTranscodeFailedChunk(fixture, 3);
    finalizeSession(fixture);

    const snapshot = fixture.store.getAiCleanupSttTerminalSnapshot(fixture.sessionId);

    assert.equal(snapshot?.isTerminal, true);
    assert.equal(snapshot?.canGenerateDraft, true);
    assert.equal(snapshot?.canInvokeRunner, true);
    assert.equal(snapshot?.sttFailedCount, 1);
    assert.equal(snapshot?.chunksWithTranscodeFailedCount, 1);
    assert.equal(snapshot?.chunksMissingSttJobCount, 1);
    assert.equal(snapshot?.chunksMissingSttAudioCount, 1);
    assert.equal(snapshot?.warnings.length, 4);
  } finally {
    fixture.close();
  }
});

test("repairExpiredAiCleanupProcessingJobs requeues retryable jobs and fails exhausted jobs", () => {
  const fixture = createFixture();
  try {
    addCompletedRealSttChunk(fixture, 1);
    finalizeSession(fixture);
    const timelineInput = buildPhase4TimelineInput(fixture.store, {
      sessionId: fixture.sessionId,
    });

    const retryable = fixture.store.getOrCreateAiCleanupJob({
      id: "ai_retryable",
      sessionId: fixture.sessionId,
      provider: "fake",
      model: "model-a",
      command: null,
      promptVersion: PHASE4_AI_CLEANUP_PROMPT_VERSION,
      inputContractVersion: timelineInput.timeline.contractVersion,
      inputHash: timelineInput.inputHash,
      inputEntryCount: timelineInput.timeline.entries.length,
      inputTimelineJsonPath: null,
      inputTimelineMarkdownPath: null,
      maxAttempts: 2,
    });
    const exhausted = fixture.store.getOrCreateAiCleanupJob({
      id: "ai_exhausted",
      sessionId: fixture.sessionId,
      provider: "fake",
      model: "model-b",
      command: null,
      promptVersion: PHASE4_AI_CLEANUP_PROMPT_VERSION,
      inputContractVersion: timelineInput.timeline.contractVersion,
      inputHash: timelineInput.inputHash,
      inputEntryCount: timelineInput.timeline.entries.length,
      inputTimelineJsonPath: null,
      inputTimelineMarkdownPath: null,
      maxAttempts: 1,
    });
    assert.ok(
      fixture.store.claimAiCleanupJob({
        jobId: retryable.id,
        workerId: "test",
        leaseMs: 1,
      }),
    );
    assert.ok(
      fixture.store.claimAiCleanupJob({
        jobId: exhausted.id,
        workerId: "test",
        leaseMs: 1,
      }),
    );
    fixture.database.db.prepare(
      "UPDATE ai_cleanup_jobs SET locked_until = '2000-01-01T00:00:00.000Z'",
    ).run();

    const summary = fixture.store.repairExpiredAiCleanupProcessingJobs(
      "2026-05-06T00:00:00.000Z",
    );

    assert.deepEqual(summary, { requeued: 1, failed: 1 });
    assert.equal(fixture.store.getAiCleanupJob(retryable.id)?.status, "queued");
    const exhaustedAfter = fixture.store.getAiCleanupJob(exhausted.id);
    assert.equal(exhaustedAfter?.status, "failed");
    assert.equal(exhaustedAfter?.failure_kind, "provider_timeout");
  } finally {
    fixture.close();
  }
});

test("listFinalizedSessionsForAiCleanupAutomation preserves readiness ordering", () => {
  const fixture = createFixture();
  try {
    const processing = "meeting_ai_processing";
    const ready = "meeting_ai_ready";
    const empty = "meeting_ai_empty";
    const waitingStt = "meeting_ai_waiting_stt";
    const futureQueued = "meeting_ai_future_queued";

    createSessionForSelection(fixture, processing);
    addCompletedRealSttChunkForSession(fixture, processing, 1);
    finalizeSessionForSelection(fixture, processing, "2026-05-07T00:00:01.000Z");
    const processingJob = createAiCleanupJobForSelection(
      fixture,
      processing,
      "ai_processing",
    );
    assert.ok(
      fixture.store.claimAiCleanupJob({
        jobId: processingJob.id,
        workerId: "selection-test",
        leaseMs: 60000,
      }),
    );

    createSessionForSelection(fixture, ready);
    addCompletedRealSttChunkForSession(fixture, ready, 1);
    finalizeSessionForSelection(fixture, ready, "2026-05-07T00:00:02.000Z");

    createSessionForSelection(fixture, empty);
    finalizeSessionForSelection(fixture, empty, "2026-05-07T00:00:03.000Z");

    createSessionForSelection(fixture, waitingStt);
    addQueuedSttChunkForSession(fixture, waitingStt, 1);
    finalizeSessionForSelection(fixture, waitingStt, "2026-05-07T00:00:04.000Z");

    createSessionForSelection(fixture, futureQueued);
    addCompletedRealSttChunkForSession(fixture, futureQueued, 1);
    finalizeSessionForSelection(fixture, futureQueued, "2026-05-07T00:00:05.000Z");
    const futureJob = createAiCleanupJobForSelection(
      fixture,
      futureQueued,
      "ai_future_queued",
    );
    fixture.database.db
      .prepare("UPDATE ai_cleanup_jobs SET next_attempt_at = ? WHERE id = ?")
      .run("2026-05-08T00:00:00.000Z", futureJob.id);

    const selected = fixture.store.listFinalizedSessionsForAiCleanupAutomation({
      limit: 10,
      provider: "fake",
      model: "selection-model",
      promptVersion: PHASE4_AI_CLEANUP_PROMPT_VERSION,
      nowIso: "2026-05-07T12:00:00.000Z",
    });

    assert.deepEqual(
      selected.map((session) => session.id),
      [processing, ready, empty, waitingStt, futureQueued],
    );
  } finally {
    fixture.close();
  }
});

type StoreFixture = {
  dir: string;
  database: DirongDatabase;
  store: SessionStore;
  sessionId: string;
  close: () => void;
};

function createFixture(): StoreFixture {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-ai-store-"));
  const database = new DirongDatabase(path.join(dir, "dirong.sqlite"), 1000);
  const store = new SessionStore(database);
  const sessionId = "meeting_ai_store_test";
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
  return {
    dir,
    database,
    store,
    sessionId,
    close: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function addCompletedRealSttChunk(fixture: StoreFixture, index: number): void {
  addQueuedSttChunk(fixture, index);
  const job = fixture.store.claimNextSttJob({
    workerId: "ai-store-test-stt",
    leaseMs: 60000,
    sessionId: fixture.sessionId,
  });
  assert.ok(job);
  fixture.store.completeSttJob({
    job,
    text: "실제 회의 발화입니다.",
    source: "real",
    provider: "local-whisper",
    model: "small",
    inputAudioSha256: `stt-${index}`,
  });
}

function addNoSpeechChunk(fixture: StoreFixture, index: number): void {
  addQueuedSttChunk(fixture, index);
  const job = fixture.store.claimNextSttJob({
    workerId: "ai-store-test-stt",
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

function addFailedSttChunk(fixture: StoreFixture, index: number): void {
  addQueuedSttChunk(fixture, index, { maxAttempts: 1 });
  const job = fixture.store.claimNextSttJob({
    workerId: "ai-store-test-stt",
    leaseMs: 60000,
    sessionId: fixture.sessionId,
  });
  assert.ok(job);
  fixture.store.failProcessingSttJob({
    jobId: job.id,
    error: "deterministic STT failure",
  });
}

function addTranscodeFailedChunk(fixture: StoreFixture, index: number): void {
  const chunkId = addRawFinalizedChunk(fixture, index);
  fixture.store.markChunkTranscodeFailed({
    chunkId,
    error: "deterministic transcode failure",
  });
}

function addQueuedSttChunk(
  fixture: StoreFixture,
  index: number,
  options: { maxAttempts?: number } = {},
): void {
  const chunkId = addRawFinalizedChunk(fixture, index);
  fixture.store.completeChunkTranscodeAndQueueJob({
    chunkId,
    sttAudioPath: path.join(fixture.dir, `${chunkId}.webm`),
    sttAudioFormat: "webm",
    sttByteSize: 10,
    sttSha256: `stt-${index}`,
    maxAttempts: options.maxAttempts ?? 3,
  });
}

function addRawFinalizedChunk(fixture: StoreFixture, index: number): string {
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
  return chunkId;
}

function finalizeSession(fixture: StoreFixture): void {
  fixture.store.stopSession({
    sessionId: fixture.sessionId,
    stoppedByUserId: "starter",
    stoppedByDisplayName: "Taniar",
    status: "finalized",
  });
}

function createSessionForSelection(
  fixture: StoreFixture,
  sessionId: string,
): void {
  fixture.store.createSession({
    id: sessionId,
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
}

function addCompletedRealSttChunkForSession(
  fixture: StoreFixture,
  sessionId: string,
  index: number,
): void {
  addQueuedSttChunkForSession(fixture, sessionId, index);
  const job = fixture.store.claimNextSttJob({
    workerId: "ai-selection-test-stt",
    leaseMs: 60000,
    sessionId,
  });
  assert.ok(job);
  fixture.store.completeSttJob({
    job,
    text: `실제 회의 발화입니다 ${sessionId}.`,
    source: "real",
    provider: "local-whisper",
    model: "small",
    inputAudioSha256: `stt-${sessionId}-${index}`,
  });
}

function addQueuedSttChunkForSession(
  fixture: StoreFixture,
  sessionId: string,
  index: number,
): void {
  const chunkId = addRawFinalizedChunkForSession(fixture, sessionId, index);
  fixture.store.completeChunkTranscodeAndQueueJob({
    chunkId,
    sttAudioPath: path.join(fixture.dir, sessionId, `${chunkId}.webm`),
    sttAudioFormat: "webm",
    sttByteSize: 10,
    sttSha256: `stt-${sessionId}-${index}`,
    maxAttempts: 3,
  });
}

function addRawFinalizedChunkForSession(
  fixture: StoreFixture,
  sessionId: string,
  index: number,
): string {
  const chunkId = `${sessionId}_${String(index).padStart(6, "0")}_speaker`;
  fixture.store.createChunkWriting({
    chunkId,
    sessionId,
    chunkIndex: index,
    userId: "speaker",
    displayNameSnapshot: "Taniar",
    startedAtMs: index * 1000,
    rawAudioPath: path.join(fixture.dir, sessionId, `${chunkId}.ogg`),
  });
  fixture.store.finalizeRawChunk({
    chunkId,
    endedAtMs: index * 1000 + 500,
    durationMs: 500,
    rawByteSize: 10,
    rawSha256: `raw-${sessionId}-${index}`,
    closeReason: "test",
    pipelineError: null,
  });
  return chunkId;
}

function finalizeSessionForSelection(
  fixture: StoreFixture,
  sessionId: string,
  finalizedAt: string,
): void {
  fixture.store.stopSession({
    sessionId,
    stoppedByUserId: "starter",
    stoppedByDisplayName: "Taniar",
    status: "finalized",
  });
  fixture.database.db
    .prepare(
      `UPDATE sessions
       SET created_at = ?, updated_at = ?, stopped_at = ?, finalized_at = ?
       WHERE id = ?`,
    )
    .run(finalizedAt, finalizedAt, finalizedAt, finalizedAt, sessionId);
}

function createAiCleanupJobForSelection(
  fixture: StoreFixture,
  sessionId: string,
  jobId: string,
): ReturnType<SessionStore["getOrCreateAiCleanupJob"]> {
  const timelineInput = buildPhase4TimelineInput(fixture.store, { sessionId });
  return fixture.store.getOrCreateAiCleanupJob({
    id: jobId,
    sessionId,
    provider: "fake",
    model: "selection-model",
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
