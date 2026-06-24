import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createStorageContext } from "./storage-context.js";
import { DirongDatabase } from "./sqlite.js";
import { SqlRunner } from "./sql-runner.js";
import { ProjectStore } from "../projects/project-store.js";

// SessionReadStore — one positive case per method group:
//   1. session reads (getSession, getLatestSession, listFinalizedSessionsForAiCleanupAutomation)
//   2. chunk reads (getChunk, listWritingChunks, listChunksMissingSttJob)
//   3. transcript reads (listRecentTranscriptSegments)
//   4. AI cleanup reads (listRecentAiCleanupJobs)
//   5. composite read models (getDashboardState, statusText)
//
// Real DirongDatabase against a tmp file (TESTING.md convention).

function makeFixture(): {
  ctx: ReturnType<typeof createStorageContext>;
  close(): void;
} {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "dirong-read-store-"));
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

function seedTwoSessions(ctx: ReturnType<typeof createStorageContext>): void {
  ctx.writes.createSession({
    id: "sess-old",
    guildId: "guild-1",
    guildName: null,
    textChannelId: null,
    voiceChannelId: "voice-1",
    voiceChannelName: null,
    startedByUserId: "user-1",
    startedByDisplayName: "User One",
    dataDir: "/tmp/data",
  });
  ctx.writes.createSession({
    id: "sess-new",
    guildId: "guild-1",
    guildName: null,
    textChannelId: null,
    voiceChannelId: "voice-1",
    voiceChannelName: null,
    startedByUserId: "user-1",
    startedByDisplayName: "User One",
    dataDir: "/tmp/data",
  });
}

test("SessionReadStore.getSession + getLatestSession return inserted rows", () => {
  const fixture = makeFixture();
  try {
    seedTwoSessions(fixture.ctx);
    const newest = fixture.ctx.reads.getLatestSession();
    assert.ok(newest);
    // started_at is ISO-now (ms precision); when both inserts land in the same
    // millisecond the started_at values tie, so getLatest resolves the tie by
    // rowid DESC -> the later-inserted row (sess-new) wins. Deterministic.
    assert.equal(newest.id, "sess-new");
    const fetched = fixture.ctx.reads.getSession("sess-old");
    assert.ok(fetched);
    assert.equal(fetched.id, "sess-old");
  } finally {
    fixture.close();
  }
});

test("SessionReadStore.getChunk + listWritingChunks reflect chunk lifecycle", () => {
  const fixture = makeFixture();
  try {
    fixture.ctx.writes.createSession({
      id: "sess-1",
      guildId: "guild-1",
      guildName: null,
      textChannelId: null,
      voiceChannelId: "voice-1",
      voiceChannelName: null,
      startedByUserId: "user-1",
      startedByDisplayName: "User One",
      dataDir: "/tmp/data",
    });
    fixture.ctx.writes.upsertSpeaker({
      sessionId: "sess-1",
      userId: "user-1",
      displayNameSnapshot: "User One",
      isBot: false,
      seenAtMs: 0,
    });
    fixture.ctx.writes.createChunkWriting({
      chunkId: "chunk-1",
      sessionId: "sess-1",
      chunkIndex: 0,
      userId: "user-1",
      displayNameSnapshot: "User One",
      startedAtMs: 100,
      rawAudioPath: "/tmp/data/c1.opus",
    });

    const writing = fixture.ctx.reads.listWritingChunks();
    assert.equal(writing.length, 1);
    assert.equal(writing[0]?.id, "chunk-1");

    const chunk = fixture.ctx.reads.getChunk("chunk-1");
    assert.ok(chunk);
    assert.equal(chunk.status, "writing");
    // No STT job yet → still missing
    assert.equal(fixture.ctx.reads.listChunksMissingSttJob().length, 0); // status is "writing", not in the finalized/queued/transcode_failed set
  } finally {
    fixture.close();
  }
});

test("SessionReadStore.listRecentTranscriptSegments returns segments inserted via completeSttJob", () => {
  const fixture = makeFixture();
  try {
    fixture.ctx.writes.createSession({
      id: "sess-1",
      guildId: "guild-1",
      guildName: null,
      textChannelId: null,
      voiceChannelId: "voice-1",
      voiceChannelName: null,
      startedByUserId: "user-1",
      startedByDisplayName: "User One",
      dataDir: "/tmp/data",
    });
    fixture.ctx.writes.upsertSpeaker({
      sessionId: "sess-1",
      userId: "user-1",
      displayNameSnapshot: "User One",
      isBot: false,
      seenAtMs: 0,
    });
    fixture.ctx.writes.createChunkWriting({
      chunkId: "chunk-1",
      sessionId: "sess-1",
      chunkIndex: 0,
      userId: "user-1",
      displayNameSnapshot: "User One",
      startedAtMs: 100,
      rawAudioPath: "/tmp/data/c1.opus",
    });
    fixture.ctx.writes.finalizeRawChunk({
      chunkId: "chunk-1",
      endedAtMs: 200,
      durationMs: 100,
      rawByteSize: 0,
      rawSha256: null,
      closeReason: "stop",
      pipelineError: null,
    });
    fixture.ctx.writes.completeChunkTranscodeAndQueueJob({
      chunkId: "chunk-1",
      sttAudioPath: "/tmp/data/c1.wav",
      sttAudioFormat: "wav",
      sttByteSize: 0,
      sttSha256: null,
      maxAttempts: 3,
    });
    const job = fixture.ctx.jobs.claimNextSttJob({
      workerId: "worker-1",
      leaseMs: 1000,
    });
    assert.ok(job);
    fixture.ctx.writes.completeSttJob({
      job,
      text: "transcribed text",
      source: "test",
      provider: "test",
      model: "test",
    });

    const segments = fixture.ctx.reads.listRecentTranscriptSegments(
      "sess-1",
      5,
    );
    assert.equal(segments.length, 1);
    assert.equal(segments[0]?.text, "transcribed text");
  } finally {
    fixture.close();
  }
});

test("SessionReadStore.listRecentAiCleanupJobs returns mapped rows", () => {
  const fixture = makeFixture();
  try {
    fixture.ctx.writes.createSession({
      id: "sess-1",
      guildId: "guild-1",
      guildName: null,
      textChannelId: null,
      voiceChannelId: "voice-1",
      voiceChannelName: null,
      startedByUserId: "user-1",
      startedByDisplayName: "User One",
      dataDir: "/tmp/data",
    });
    fixture.ctx.jobs.getOrCreateAiCleanupJob({
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

    const jobs = fixture.ctx.reads.listRecentAiCleanupJobs("sess-1", 10);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]?.id, "ai-1");
    assert.equal(jobs[0]?.status, "queued");
  } finally {
    fixture.close();
  }
});

test("SessionReadStore composite read-models build without throwing", () => {
  const fixture = makeFixture();
  try {
    seedTwoSessions(fixture.ctx);
    const dashboard = fixture.ctx.reads.getDashboardState(
      {
        isRecording: false,
        sessionId: null,
        voiceChannelId: null,
        voiceChannelName: null,
        openChunks: 0,
      },
      null,
    );
    assert.ok(dashboard, "dashboard state should be produced");

    const status = fixture.ctx.reads.statusText(
      {
        isRecording: false,
        sessionId: null,
        voiceChannelId: null,
        voiceChannelName: null,
        openChunks: 0,
      },
      "http://localhost",
    );
    assert.equal(typeof status, "string");
    assert.ok(status.length > 0, "status text should be non-empty");
  } finally {
    fixture.close();
  }
});

test("SessionReadStore.getLatestSessionForProject filters by project + tie-breaks by rowid", () => {
  const fixture = makeFixture();
  try {
    const projects = new ProjectStore(new SqlRunner(fixture.ctx.database));
    projects.createReadyProject({ id: "proj-a", name: "Project A" });
    projects.createReadyProject({ id: "proj-b", name: "Project B" });

    // Two sessions for project A and one for project B. With ms-precision
    // started_at the two A sessions can tie; rowid DESC must pick the later one.
    fixture.ctx.writes.createSession({
      id: "a-old",
      projectId: "proj-a",
      guildId: "guild-a",
      guildName: null,
      textChannelId: null,
      voiceChannelId: "voice-a",
      voiceChannelName: null,
      startedByUserId: "user-1",
      startedByDisplayName: "User One",
      dataDir: "/tmp/data",
    });
    fixture.ctx.writes.createSession({
      id: "a-new",
      projectId: "proj-a",
      guildId: "guild-a",
      guildName: null,
      textChannelId: null,
      voiceChannelId: "voice-a",
      voiceChannelName: null,
      startedByUserId: "user-1",
      startedByDisplayName: "User One",
      dataDir: "/tmp/data",
    });
    fixture.ctx.writes.createSession({
      id: "b-only",
      projectId: "proj-b",
      guildId: "guild-b",
      guildName: null,
      textChannelId: null,
      voiceChannelId: "voice-b",
      voiceChannelName: null,
      startedByUserId: "user-1",
      startedByDisplayName: "User One",
      dataDir: "/tmp/data",
    });

    const latestA = fixture.ctx.reads.getLatestSessionForProject("proj-a");
    assert.ok(latestA);
    assert.equal(latestA.id, "a-new");

    const latestB = fixture.ctx.reads.getLatestSessionForProject("proj-b");
    assert.ok(latestB);
    assert.equal(latestB.id, "b-only");

    // A project with no sessions returns null (no global fallback).
    const latestMissing =
      fixture.ctx.reads.getLatestSessionForProject("proj-missing");
    assert.equal(latestMissing, null);
  } finally {
    fixture.close();
  }
});
