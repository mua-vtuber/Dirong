import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createStorageContext } from "./storage-context.js";
import { DirongDatabase } from "./sqlite.js";

// JobQueueStore — one positive case per method group:
//   1. STT queue (claimNextSttJob picks up a queued job and marks it processing)
//   2. queueExistingSttJobForChunk re-queues an existing transcoded chunk
//   3. failJobsWithMissingAudio surfaces missing inputs as repair items
//   4. AI cleanup queue: getOrCreate + claim + updateArtifacts + block
//   5. retryAiCleanupJob requeues a failed job

function makeFixture(): {
  ctx: ReturnType<typeof createStorageContext>;
  close(): void;
} {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "dirong-job-queue-"));
  const database = new DirongDatabase(path.join(tmpDir, "dirong.sqlite"), 1000);
  const ctx = createStorageContext(database);
  return {
    ctx,
    close(): void {
      try {
        ctx.close();
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  };
}

function seedSessionAndQueuedSttJob(
  ctx: ReturnType<typeof createStorageContext>,
): { sessionId: string; chunkId: string } {
  const sessionId = "sess-1";
  const chunkId = "chunk-1";
  ctx.writes.createSession({
    id: sessionId,
    guildId: "guild-1",
    guildName: null,
    textChannelId: null,
    voiceChannelId: "voice-1",
    voiceChannelName: null,
    startedByUserId: "user-1",
    startedByDisplayName: "User One",
    dataDir: "/tmp/data",
  });
  ctx.writes.upsertSpeaker({
    sessionId,
    userId: "user-1",
    displayNameSnapshot: "User One",
    isBot: false,
    seenAtMs: 0,
  });
  ctx.writes.createChunkWriting({
    chunkId,
    sessionId,
    chunkIndex: 0,
    userId: "user-1",
    displayNameSnapshot: "User One",
    startedAtMs: 100,
    rawAudioPath: "/tmp/data/c1.opus",
  });
  ctx.writes.finalizeRawChunk({
    chunkId,
    endedAtMs: 200,
    durationMs: 100,
    rawByteSize: 0,
    rawSha256: null,
    closeReason: "stop",
    pipelineError: null,
  });
  ctx.writes.completeChunkTranscodeAndQueueJob({
    chunkId,
    sttAudioPath: "/tmp/data/c1.wav",
    sttAudioFormat: "wav",
    sttByteSize: 0,
    sttSha256: null,
    maxAttempts: 3,
  });
  return { sessionId, chunkId };
}

test("JobQueueStore.claimNextSttJob marks the queued job as processing", () => {
  const fixture = makeFixture();
  try {
    seedSessionAndQueuedSttJob(fixture.ctx);

    const claimed = fixture.ctx.jobs.claimNextSttJob({
      workerId: "worker-A",
      leaseMs: 60_000,
    });

    assert.ok(claimed, "should claim the queued job");
    assert.equal(claimed.status, "processing");
    assert.equal(claimed.locked_by, "worker-A");
  } finally {
    fixture.close();
  }
});

test("JobQueueStore.queueExistingSttJobForChunk re-queues an STT job for an already-transcoded chunk", () => {
  const fixture = makeFixture();
  try {
    const { chunkId } = seedSessionAndQueuedSttJob(fixture.ctx);
    // Claim and process the job, then fail it so the chunk has stt_audio_path
    // but no live queued job. queueExistingSttJobForChunk should restore it.
    const job = fixture.ctx.jobs.claimNextSttJob({
      workerId: "w-1",
      leaseMs: 1000,
    });
    assert.ok(job);
    fixture.ctx.writes.failProcessingSttJob({
      jobId: job.id,
      error: "test",
    });

    const requeued = fixture.ctx.jobs.queueExistingSttJobForChunk(chunkId, 5);
    assert.equal(requeued, true);

    const chunk = fixture.ctx.reads.getChunk(chunkId);
    assert.ok(chunk);
    assert.equal(chunk.status, "queued");
  } finally {
    fixture.close();
  }
});

test("JobQueueStore.failJobsWithMissingAudio fails jobs whose audio file is absent", () => {
  const fixture = makeFixture();
  try {
    seedSessionAndQueuedSttJob(fixture.ctx);

    // The seeded job's input_audio_path is "/tmp/data/c1.wav" which does not
    // exist on disk → failJobsWithMissingAudio should fail it.
    const failedCount = fixture.ctx.jobs.failJobsWithMissingAudio();
    assert.equal(failedCount, 1);

    const queued = fixture.ctx.reads.listQueuedSttJobs({ limit: 10 });
    assert.equal(queued.length, 0, "no jobs remain queued");
  } finally {
    fixture.close();
  }
});

test("JobQueueStore AI-cleanup lifecycle: getOrCreate + claim + block", () => {
  const fixture = makeFixture();
  try {
    seedSessionAndQueuedSttJob(fixture.ctx);

    const created = fixture.ctx.jobs.getOrCreateAiCleanupJob({
      id: "ai-1",
      sessionId: "sess-1",
      provider: "anthropic",
      model: "claude-4",
      command: null,
      promptVersion: "v1",
      inputContractVersion: "v1",
      inputHash: "h1",
      inputEntryCount: 1,
      inputTimelineJsonPath: null,
      inputTimelineMarkdownPath: null,
      maxAttempts: 3,
    });
    assert.equal(created.status, "queued");

    const claimed = fixture.ctx.jobs.claimAiCleanupJob({
      jobId: created.id,
      workerId: "w-AI",
      leaseMs: 60_000,
    });
    assert.ok(claimed, "AI cleanup job should be claimable");
    assert.equal(claimed.status, "processing");
    assert.equal(claimed.locked_by, "w-AI");

    fixture.ctx.jobs.blockAiCleanupJob({
      jobId: created.id,
      failureKind: "provider_auth_required",
      error: "needs auth",
    });

    const blocked = fixture.ctx.reads.getAiCleanupJob(created.id);
    assert.ok(blocked);
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.failure_kind, "provider_auth_required");
  } finally {
    fixture.close();
  }
});

test("JobQueueStore.retryAiCleanupJob requeues a failed AI cleanup job", () => {
  const fixture = makeFixture();
  try {
    seedSessionAndQueuedSttJob(fixture.ctx);
    const job = fixture.ctx.jobs.getOrCreateAiCleanupJob({
      id: "ai-1",
      sessionId: "sess-1",
      provider: "anthropic",
      model: "claude-4",
      command: null,
      promptVersion: "v1",
      inputContractVersion: "v1",
      inputHash: "h1",
      inputEntryCount: 1,
      inputTimelineJsonPath: null,
      inputTimelineMarkdownPath: null,
      maxAttempts: 1,
    });
    fixture.ctx.jobs.claimAiCleanupJob({
      jobId: job.id,
      workerId: "w-AI",
      leaseMs: 60_000,
    });
    // Drive to failed via failProcessing with attempts >= max
    fixture.ctx.jobs.failProcessingAiCleanupJob({
      jobId: job.id,
      failureKind: "provider_timeout",
      error: "timeout",
    });
    const failed = fixture.ctx.reads.getAiCleanupJob(job.id);
    assert.ok(failed);
    assert.equal(failed.status, "failed");

    const retried = fixture.ctx.jobs.retryAiCleanupJob({
      jobId: job.id,
      nowIso: new Date().toISOString(),
      maxAttempts: 3,
    });
    assert.ok(retried);
    assert.equal(retried.status, "queued");
    assert.equal(retried.attempts, 0);
  } finally {
    fixture.close();
  }
});
