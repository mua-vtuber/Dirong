import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createStorageContext } from "./storage-context.js";
import { DirongDatabase } from "./sqlite.js";

// RuntimeStateStore — one positive case per method group:
//   1. releaseExpiredProcessingLeases re-queues an STT job whose lease expired
//   2. releaseExpiredAiCleanupLeases re-queues an AI cleanup job whose lease expired
//   3. repairExpiredAiCleanupProcessingJobs reports requeued/failed counts
//   4. normalizeStoredPaths walks every path column and rewrites absolute paths
//      to storage-root-relative form (uses storageRoot option).

function makeFixture(opts?: { storageRoot?: string | null }): {
  ctx: ReturnType<typeof createStorageContext>;
  tmpDir: string;
  close(): void;
} {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "dirong-runtime-"));
  const database = new DirongDatabase(path.join(tmpDir, "dirong.sqlite"), 1000);
  const ctx = createStorageContext(database, {
    storageRoot: opts?.storageRoot ?? null,
  });
  return {
    ctx,
    tmpDir,
    close(): void {
      try {
        ctx.close();
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  };
}

test("RuntimeStateStore.releaseExpiredProcessingLeases requeues STT jobs with expired locks", () => {
  const fixture = makeFixture();
  try {
    // Seed a session + chunk + queued STT job
    fixture.ctx.writes.createSession({
      id: "sess-1",
      guildId: "g",
      guildName: null,
      textChannelId: null,
      voiceChannelId: "v",
      voiceChannelName: null,
      startedByUserId: "u",
      startedByDisplayName: "U",
      dataDir: "/tmp/data",
    });
    fixture.ctx.writes.upsertSpeaker({
      sessionId: "sess-1",
      userId: "u",
      displayNameSnapshot: "U",
      isBot: false,
      seenAtMs: 0,
    });
    fixture.ctx.writes.createChunkWriting({
      chunkId: "c1",
      sessionId: "sess-1",
      chunkIndex: 0,
      userId: "u",
      displayNameSnapshot: "U",
      startedAtMs: 0,
      rawAudioPath: "/tmp/data/c1.opus",
    });
    fixture.ctx.writes.finalizeRawChunk({
      chunkId: "c1",
      endedAtMs: 100,
      durationMs: 100,
      rawByteSize: 0,
      rawSha256: null,
      closeReason: "stop",
      pipelineError: null,
    });
    fixture.ctx.writes.completeChunkTranscodeAndQueueJob({
      chunkId: "c1",
      sttAudioPath: "/tmp/data/c1.wav",
      sttAudioFormat: "wav",
      sttByteSize: 0,
      sttSha256: null,
      maxAttempts: 3,
    });
    const job = fixture.ctx.jobs.claimNextSttJob({
      workerId: "w",
      leaseMs: 1000,
    });
    assert.ok(job);

    // Forge an expired lease — locked_until in the past
    fixture.ctx.database.db
      .prepare(
        "UPDATE stt_jobs SET locked_until = ? WHERE id = ?",
      )
      .run("1970-01-01T00:00:00.000Z", job.id);

    const released = fixture.ctx.runtime.releaseExpiredProcessingLeases();
    assert.equal(released, 1);

    const queued = fixture.ctx.reads.listQueuedSttJobs({ limit: 10 });
    assert.equal(queued.length, 1);
    assert.equal(queued[0]?.id, job.id);
  } finally {
    fixture.close();
  }
});

test("RuntimeStateStore.releaseExpiredAiCleanupLeases requeues AI cleanup jobs with expired locks", () => {
  const fixture = makeFixture();
  try {
    fixture.ctx.writes.createSession({
      id: "sess-1",
      guildId: "g",
      guildName: null,
      textChannelId: null,
      voiceChannelId: "v",
      voiceChannelName: null,
      startedByUserId: "u",
      startedByDisplayName: "U",
      dataDir: "/tmp/data",
    });
    const aiJob = fixture.ctx.jobs.getOrCreateAiCleanupJob({
      id: "ai-1",
      sessionId: "sess-1",
      provider: "anthropic",
      model: "claude-4",
      command: null,
      promptVersion: "v1",
      inputContractVersion: "v1",
      inputHash: "h1",
      inputEntryCount: 0,
      inputTimelineJsonPath: null,
      inputTimelineMarkdownPath: null,
      maxAttempts: 3,
    });
    fixture.ctx.jobs.claimAiCleanupJob({
      jobId: aiJob.id,
      workerId: "w-AI",
      leaseMs: 60_000,
    });
    // Force expired lock
    fixture.ctx.database.db
      .prepare(
        "UPDATE ai_cleanup_jobs SET locked_until = ? WHERE id = ?",
      )
      .run("1970-01-01T00:00:00.000Z", aiJob.id);

    const released = fixture.ctx.runtime.releaseExpiredAiCleanupLeases();
    assert.equal(released, 1);
  } finally {
    fixture.close();
  }
});

test("RuntimeStateStore.repairExpiredAiCleanupProcessingJobs reports requeued/failed counts", () => {
  const fixture = makeFixture();
  try {
    fixture.ctx.writes.createSession({
      id: "sess-1",
      guildId: "g",
      guildName: null,
      textChannelId: null,
      voiceChannelId: "v",
      voiceChannelName: null,
      startedByUserId: "u",
      startedByDisplayName: "U",
      dataDir: "/tmp/data",
    });
    const aiJob = fixture.ctx.jobs.getOrCreateAiCleanupJob({
      id: "ai-2",
      sessionId: "sess-1",
      provider: "anthropic",
      model: "claude-4",
      command: null,
      promptVersion: "v1",
      inputContractVersion: "v1",
      inputHash: "h2",
      inputEntryCount: 0,
      inputTimelineJsonPath: null,
      inputTimelineMarkdownPath: null,
      maxAttempts: 3,
    });
    fixture.ctx.jobs.claimAiCleanupJob({
      jobId: aiJob.id,
      workerId: "w-AI",
      leaseMs: 60_000,
    });
    fixture.ctx.database.db
      .prepare(
        "UPDATE ai_cleanup_jobs SET locked_until = ? WHERE id = ?",
      )
      .run("1970-01-01T00:00:00.000Z", aiJob.id);

    const summary = fixture.ctx.runtime.repairExpiredAiCleanupProcessingJobs();
    assert.equal(summary.requeued, 1);
    assert.equal(summary.failed, 0);
  } finally {
    fixture.close();
  }
});

test("RuntimeStateStore.normalizeStoredPaths rewrites absolute paths to storage-root-relative form", () => {
  // Use a real storageRoot under tmpDir so absolute paths can be normalized
  // against it. We seed rows with absolute paths under storageRoot, then call
  // normalizeStoredPaths and assert the on-disk values are now relative.
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "dirong-normalize-"));
  const storageRoot = path.join(tmpDir, "store");
  const database = new DirongDatabase(
    path.join(tmpDir, "dirong.sqlite"),
    1000,
  );
  // First open without normalize: write an absolute path that lives under
  // storageRoot. The path-resolver only normalizes when `storageRoot` is set,
  // so the first context (no storageRoot) writes the raw absolute path.
  const seedCtx = createStorageContext(database);
  try {
    seedCtx.writes.createSession({
      id: "sess-1",
      guildId: "g",
      guildName: null,
      textChannelId: null,
      voiceChannelId: "v",
      voiceChannelName: null,
      startedByUserId: "u",
      startedByDisplayName: "U",
      dataDir: path.join(storageRoot, "sessions", "sess-1"),
    });

    // Read raw value via the underlying DB — confirm it's the absolute path
    const before = database.db
      .prepare("SELECT data_dir FROM sessions WHERE id = ?")
      .get("sess-1") as { data_dir: string };
    assert.equal(
      before.data_dir,
      path.join(storageRoot, "sessions", "sess-1"),
      "seeded path should be absolute before normalization",
    );

    // Now open a context with storageRoot AND normalizeStoredPaths: true.
    // The constructor side-effect sweeps every absolute path column under
    // storageRoot to its forward-slash relative form — the returned context
    // is intentionally unused here; closing the shared database happens
    // once in the outer finally below.
    createStorageContext(database, {
      storageRoot,
      normalizeStoredPaths: true,
    });
    const after = database.db
      .prepare("SELECT data_dir FROM sessions WHERE id = ?")
      .get("sess-1") as { data_dir: string };
    assert.equal(
      after.data_dir,
      "sessions/sess-1",
      "absolute path under storageRoot should be rewritten to a forward-slash relative path",
    );
  } finally {
    database.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
