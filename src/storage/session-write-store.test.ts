import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Phase1Config } from "../config.js";
import { runStartupRepair } from "./repair-scan.js";
import { createStorageContext } from "./storage-context.js";
import { DirongDatabase } from "./sqlite.js";

// SessionWriteStore — one positive case per method group:
//   1. session lifecycle (create + stop)
//   2. chunk writes (createChunkWriting + finalizeRawChunk + transcode+queue)
//   3. repair items (recordRepairItem)
//   4. STT job completion (completeSttJob produces a transcript segment)
//   5. AI cleanup job completion (completeAiCleanupJob inserts a draft)
//
// Tests use a real DirongDatabase against a tmp file per TESTING.md ("never mock
// node:sqlite"). createStorageContext threads ONE SqlRunner across the facade —
// proven by the storage-context test, used here implicitly.

function makeFixture(): {
  ctx: ReturnType<typeof createStorageContext>;
  tmpDir: string;
  close(): void;
} {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "dirong-write-store-"));
  const database = new DirongDatabase(path.join(tmpDir, "dirong.sqlite"), 1000);
  const ctx = createStorageContext(database);
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

function seedSessionAndChunk(ctx: ReturnType<typeof createStorageContext>): {
  sessionId: string;
  chunkId: string;
} {
  const sessionId = "sess-1";
  const chunkId = "chunk-1";
  ctx.writes.createSession({
    id: sessionId,
    guildId: "guild-1",
    guildName: "Guild One",
    textChannelId: "text-1",
    voiceChannelId: "voice-1",
    voiceChannelName: "Voice One",
    startedByUserId: "user-1",
    startedByDisplayName: "User One",
    dataDir: "/tmp/data",
  });
  // chunks has a composite FK on (session_id, user_id) → session_speakers;
  // seed the speaker before any chunk write or createChunkWriting will fail.
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
    rawAudioPath: "/tmp/data/chunk-1.opus",
  });
  ctx.writes.finalizeRawChunk({
    chunkId,
    endedAtMs: 200,
    durationMs: 100,
    rawByteSize: 1024,
    rawSha256: "deadbeef",
    closeReason: "stop",
    pipelineError: null,
  });
  return { sessionId, chunkId };
}

test("SessionWriteStore.createSession + stopSession persists status transitions", () => {
  const fixture = makeFixture();
  try {
    fixture.ctx.writes.createSession({
      id: "sess-a",
      guildId: "guild-a",
      guildName: null,
      textChannelId: null,
      voiceChannelId: "voice-a",
      voiceChannelName: null,
      startedByUserId: "user-a",
      startedByDisplayName: "User A",
      dataDir: "/tmp/data",
    });
    fixture.ctx.writes.stopSession({
      sessionId: "sess-a",
      stoppedByUserId: "user-a",
      stoppedByDisplayName: "User A",
      status: "finalized",
    });

    const row = fixture.ctx.reads.getSession("sess-a");
    assert.ok(row, "session should exist after createSession");
    assert.equal(row.status, "finalized");
    assert.equal(row.stopped_by_user_id, "user-a");
  } finally {
    fixture.close();
  }
});

test("SessionWriteStore chunk lifecycle (create/finalize/transcode) queues STT job", () => {
  const fixture = makeFixture();
  try {
    const { chunkId } = seedSessionAndChunk(fixture.ctx);
    fixture.ctx.writes.completeChunkTranscodeAndQueueJob({
      chunkId,
      sttAudioPath: "/tmp/data/chunk-1.wav",
      sttAudioFormat: "wav",
      sttByteSize: 2048,
      sttSha256: "cafefade",
      maxAttempts: 3,
    });

    const chunk = fixture.ctx.reads.getChunk(chunkId);
    assert.ok(chunk);
    assert.equal(chunk.status, "queued");
    assert.equal(chunk.transcode_status, "done");

    const queued = fixture.ctx.reads.listQueuedSttJobs({ limit: 10 });
    assert.equal(queued.length, 1, "exactly one STT job should be queued");
    assert.equal(queued[0]?.chunk_id, chunkId);
  } finally {
    fixture.close();
  }
});

test("SessionWriteStore.ignoreChunk marks empty chunks skipped without speaker counts", () => {
  const fixture = makeFixture();
  try {
    const sessionId = "sess-empty";
    const chunkId = "chunk-empty";
    fixture.ctx.writes.createSession({
      id: sessionId,
      guildId: "guild-1",
      guildName: "Guild One",
      textChannelId: "text-1",
      voiceChannelId: "voice-1",
      voiceChannelName: "Voice One",
      startedByUserId: "user-1",
      startedByDisplayName: "User One",
      dataDir: "/tmp/data",
    });
    fixture.ctx.writes.upsertSpeaker({
      sessionId,
      userId: "user-1",
      displayNameSnapshot: "User One",
      isBot: false,
      seenAtMs: 0,
    });
    fixture.ctx.writes.createChunkWriting({
      chunkId,
      sessionId,
      chunkIndex: 1,
      userId: "user-1",
      displayNameSnapshot: "User One",
      startedAtMs: 100,
      rawAudioPath: "/tmp/data/empty.ogg",
    });
    fixture.ctx.writes.finalizeRawChunk({
      chunkId,
      endedAtMs: 104,
      durationMs: 4,
      rawByteSize: 0,
      rawSha256: null,
      closeReason: "after_silence",
      pipelineError: { message: "Failed to decrypt" },
    });
    const countedSpeaker = fixture.ctx.database.db
      .prepare(
        "SELECT chunk_count FROM session_speakers WHERE session_id = ? AND user_id = ?",
      )
      .get(sessionId, "user-1") as { chunk_count: number } | undefined;
    assert.equal(countedSpeaker?.chunk_count, 1);
    fixture.ctx.writes.ignoreChunk({
      chunkId,
      endedAtMs: 104,
      durationMs: 4,
      rawByteSize: 0,
      closeReason: "after_silence",
      pipelineError: { message: "Failed to decrypt" },
      reason: "empty raw audio chunk skipped before STT",
    });

    const chunk = fixture.ctx.reads.getChunk(chunkId);
    assert.ok(chunk);
    assert.equal(chunk.status, "ignored");
    assert.equal(chunk.transcode_status, "skipped");
    assert.equal(chunk.transcode_error, "empty raw audio chunk skipped before STT");

    const speaker = fixture.ctx.database.db
      .prepare(
        "SELECT chunk_count FROM session_speakers WHERE session_id = ? AND user_id = ?",
      )
      .get(sessionId, "user-1") as { chunk_count: number } | undefined;
    assert.equal(speaker?.chunk_count, 0);
  } finally {
    fixture.close();
  }
});

test("startup repair ignores existing zero-byte chunks without reopening STT repair", async () => {
  const fixture = makeFixture();
  try {
    const sessionId = "sess-empty-repair";
    const chunkId = "chunk-empty-repair";
    const sessionDir = path.join(fixture.tmpDir, sessionId);
    const chunksDir = path.join(sessionDir, "chunks");
    const rawAudioPath = path.join(chunksDir, "empty.ogg");
    mkdirSync(chunksDir, { recursive: true });
    writeFileSync(rawAudioPath, "");

    fixture.ctx.writes.createSession({
      id: sessionId,
      guildId: "guild-1",
      guildName: "Guild One",
      textChannelId: "text-1",
      voiceChannelId: "voice-1",
      voiceChannelName: "Voice One",
      startedByUserId: "user-1",
      startedByDisplayName: "User One",
      dataDir: sessionDir,
    });
    fixture.ctx.writes.upsertSpeaker({
      sessionId,
      userId: "user-1",
      displayNameSnapshot: "User One",
      isBot: false,
      seenAtMs: 0,
    });
    fixture.ctx.writes.createChunkWriting({
      chunkId,
      sessionId,
      chunkIndex: 1,
      userId: "user-1",
      displayNameSnapshot: "User One",
      startedAtMs: 100,
      rawAudioPath,
    });
    fixture.ctx.writes.finalizeRawChunk({
      chunkId,
      endedAtMs: 104,
      durationMs: 4,
      rawByteSize: 0,
      rawSha256: null,
      closeReason: "after_silence",
      pipelineError: { message: "Failed to decrypt" },
    });
    fixture.ctx.writes.markChunkTranscodeFailed({
      chunkId,
      error: "파일 크기가 0바이트입니다.",
    });
    fixture.ctx.writes.recordRepairItem({
      type: "raw_audio_not_playable",
      status: "open",
      severity: "error",
      sessionId,
      chunkId,
      path: rawAudioPath,
    });

    await runStartupRepair(
      fixture.ctx,
      createRepairConfig(fixture.tmpDir, fixture.ctx.database.dbPath),
    );

    const chunk = fixture.ctx.reads.getChunk(chunkId);
    assert.ok(chunk);
    assert.equal(chunk.status, "ignored");
    assert.equal(chunk.transcode_status, "skipped");

    const repair = fixture.ctx.database.db
      .prepare(
        "SELECT status, severity FROM repair_items WHERE item_type = ? AND chunk_id = ?",
      )
      .get("raw_audio_not_playable", chunkId) as
      | { status: string; severity: string }
      | undefined;
    assert.equal(repair?.status, "ignored");
    assert.equal(repair?.severity, "info");

    const speaker = fixture.ctx.database.db
      .prepare(
        "SELECT chunk_count FROM session_speakers WHERE session_id = ? AND user_id = ?",
      )
      .get(sessionId, "user-1") as { chunk_count: number } | undefined;
    assert.equal(speaker?.chunk_count, 0);
  } finally {
    fixture.close();
  }
});

test("SessionWriteStore.recordRepairItem inserts a repair_items row with stored path", () => {
  const fixture = makeFixture();
  try {
    fixture.ctx.writes.recordRepairItem({
      type: "stt_job_missing_audio",
      severity: "error",
      path: "/tmp/data/missing.opus",
      sessionId: null,
      details: { reason: "test" },
    });

    const row = fixture.ctx.database.db
      .prepare(
        "SELECT item_type, severity, status FROM repair_items WHERE item_type = ? LIMIT 1",
      )
      .get("stt_job_missing_audio") as
      | { item_type: string; severity: string; status: string }
      | undefined;
    assert.ok(row, "repair item should be persisted");
    assert.equal(row.item_type, "stt_job_missing_audio");
    assert.equal(row.severity, "error");
    assert.equal(row.status, "open");
  } finally {
    fixture.close();
  }
});

function createRepairConfig(dataDir: string, dbPath: string): Phase1Config {
  return {
    discordBotToken: "token",
    discordClientId: "client",
    guildId: "guild-1",
    guildIds: ["guild-1"],
    dataDir,
    dbPath,
    dbBusyTimeoutMs: 1000,
    silenceMs: 1000,
    softRolloverMs: 60000,
    maxChunkMs: 120000,
    sttSafeFormat: "webm",
    sttMaxAttempts: 3,
    sttLeaseMs: 1000,
    partRepairAgeMs: 0,
    enableDave: true,
    decryptionFailureTolerance: 24,
    debugVoice: false,
    autoRegisterCommands: false,
    dashboardHost: "127.0.0.1",
    dashboardPort: 0,
    openDashboard: false,
    aloneFinalizeEnabled: false,
    aloneFinalizeGraceMs: 1000,
  };
}

test("SessionWriteStore.completeSttJob writes a transcript segment + marks job done", () => {
  const fixture = makeFixture();
  try {
    const { chunkId } = seedSessionAndChunk(fixture.ctx);
    fixture.ctx.writes.completeChunkTranscodeAndQueueJob({
      chunkId,
      sttAudioPath: "/tmp/data/chunk-1.wav",
      sttAudioFormat: "wav",
      sttByteSize: 2048,
      sttSha256: "cafefade",
      maxAttempts: 3,
    });
    const job = fixture.ctx.jobs.claimNextSttJob({
      workerId: "worker-1",
      leaseMs: 60_000,
    });
    assert.ok(job, "an STT job should be claimable");

    const segment = fixture.ctx.writes.completeSttJob({
      job,
      text: "hello world",
      source: "test",
      provider: "test-provider",
      model: "test-model",
      inputAudioSha256: "cafefade",
    });

    assert.equal(segment.session_id, "sess-1");
    assert.equal(segment.chunk_id, chunkId);
    assert.equal(segment.text, "hello world");
    assert.equal(segment.speech_status, "speech");
    assert.equal(segment.stt_job_id, job.id);
  } finally {
    fixture.close();
  }
});

test("SessionWriteStore.completeAiCleanupJob inserts a meeting_notes_drafts row", () => {
  const fixture = makeFixture();
  try {
    seedSessionAndChunk(fixture.ctx);
    const aiJob = fixture.ctx.jobs.getOrCreateAiCleanupJob({
      id: "ai-1",
      sessionId: "sess-1",
      provider: "anthropic",
      model: "claude-4",
      command: "claude",
      promptVersion: "v1",
      inputContractVersion: "v1",
      inputHash: "hash-1",
      inputEntryCount: 1,
      inputTimelineJsonPath: null,
      inputTimelineMarkdownPath: null,
      maxAttempts: 3,
    });
    assert.equal(aiJob.status, "queued");

    const draft = fixture.ctx.writes.completeAiCleanupJob({
      jobId: aiJob.id,
      draftId: "draft-1",
      schemaVersion: "v1",
      language: "en",
      title: "Title",
      summaryText: "Summary",
      draftJson: "{}",
      markdown: "# Title",
      jsonPath: "/tmp/data/draft.json",
      markdownPath: "/tmp/data/draft.md",
      rawOutputPath: "/tmp/data/raw.txt",
      provider: "anthropic",
      model: "claude-4",
      promptVersion: "v1",
      inputHash: "hash-1",
      outputHash: "out-1",
    });

    assert.equal(draft.id, "draft-1");
    assert.equal(draft.session_id, "sess-1");
    assert.equal(draft.ai_cleanup_job_id, aiJob.id);
    assert.equal(draft.validation_status, "valid");

    const refetched = fixture.ctx.reads.getAiCleanupJob(aiJob.id);
    assert.ok(refetched);
    assert.equal(refetched.status, "done");
  } finally {
    fixture.close();
  }
});
