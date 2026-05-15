import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JobQueueStore } from "./job-queue-store.js";
import { RuntimeStateStore } from "./runtime-state-store.js";
import { SessionReadStore } from "./session-read-store.js";
import { SessionWriteStore } from "./session-write-store.js";
import { DirongDatabase } from "./sqlite.js";
import { createStorageContext } from "./storage-context.js";

// storage-context.test.ts — asserts:
//   (a) createStorageContext returns all four facades + database + close
//   (b) a write through `writes` is observable via `reads` (proves the shared
//       SqlRunner — both facades see the same connection / transaction state)
//   (c) `normalizeStoredPaths: true` triggers the runtime-state-store sweep at
//       construction time

function makeFixture(opts?: { storageRoot?: string | null; normalizeStoredPaths?: boolean }): {
  ctx: ReturnType<typeof createStorageContext>;
  tmpDir: string;
  close(): void;
} {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "dirong-ctx-"));
  const database = new DirongDatabase(path.join(tmpDir, "dirong.sqlite"), 1000);
  const ctx = createStorageContext(database, opts);
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

test("createStorageContext returns all four facades + database + close", () => {
  const fixture = makeFixture();
  try {
    assert.ok(
      fixture.ctx.writes instanceof SessionWriteStore,
      "ctx.writes must be a SessionWriteStore",
    );
    assert.ok(
      fixture.ctx.reads instanceof SessionReadStore,
      "ctx.reads must be a SessionReadStore",
    );
    assert.ok(
      fixture.ctx.jobs instanceof JobQueueStore,
      "ctx.jobs must be a JobQueueStore",
    );
    assert.ok(
      fixture.ctx.runtime instanceof RuntimeStateStore,
      "ctx.runtime must be a RuntimeStateStore",
    );
    assert.ok(
      fixture.ctx.database instanceof DirongDatabase,
      "ctx.database must be the DirongDatabase passed in",
    );
    assert.equal(typeof fixture.ctx.close, "function");
  } finally {
    fixture.close();
  }
});

test("writes through ctx.writes are observable via ctx.reads (shared SqlRunner per CONTEXT.md lock)", () => {
  const fixture = makeFixture();
  try {
    fixture.ctx.writes.createSession({
      id: "sess-shared",
      guildId: "g",
      guildName: null,
      textChannelId: null,
      voiceChannelId: "v",
      voiceChannelName: null,
      startedByUserId: "u",
      startedByDisplayName: "U",
      dataDir: "/tmp/data",
    });
    const row = fixture.ctx.reads.getSession("sess-shared");
    assert.ok(row, "read facade must see the row inserted via write facade");
    assert.equal(row.id, "sess-shared");

    // Also exercise the cross-facade contract through the job queue → read path
    fixture.ctx.writes.upsertSpeaker({
      sessionId: "sess-shared",
      userId: "u",
      displayNameSnapshot: "U",
      isBot: false,
      seenAtMs: 0,
    });
    fixture.ctx.writes.createChunkWriting({
      chunkId: "c-shared",
      sessionId: "sess-shared",
      chunkIndex: 0,
      userId: "u",
      displayNameSnapshot: "U",
      startedAtMs: 0,
      rawAudioPath: "/tmp/data/c.opus",
    });
    fixture.ctx.writes.finalizeRawChunk({
      chunkId: "c-shared",
      endedAtMs: 1,
      durationMs: 1,
      rawByteSize: 0,
      rawSha256: null,
      closeReason: "stop",
      pipelineError: null,
    });
    fixture.ctx.writes.completeChunkTranscodeAndQueueJob({
      chunkId: "c-shared",
      sttAudioPath: "/tmp/data/c.wav",
      sttAudioFormat: "wav",
      sttByteSize: 0,
      sttSha256: null,
      maxAttempts: 3,
    });
    const queued = fixture.ctx.reads.listQueuedSttJobs({ limit: 5 });
    assert.equal(
      queued.length,
      1,
      "STT job written by writes facade must be visible via reads facade",
    );
  } finally {
    fixture.close();
  }
});

test("createStorageContext({ normalizeStoredPaths: true }) triggers the runtime sweep at construction", () => {
  // Seed an absolute path under storageRoot using a context WITHOUT normalize,
  // then open a second context WITH normalize and assert the row was rewritten
  // to a relative path during construction.
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "dirong-ctx-norm-"));
  const storageRoot = path.join(tmpDir, "store");
  const database = new DirongDatabase(
    path.join(tmpDir, "dirong.sqlite"),
    1000,
  );
  try {
    const seedCtx = createStorageContext(database);
    seedCtx.writes.createSession({
      id: "sess-norm",
      guildId: "g",
      guildName: null,
      textChannelId: null,
      voiceChannelId: "v",
      voiceChannelName: null,
      startedByUserId: "u",
      startedByDisplayName: "U",
      dataDir: path.join(storageRoot, "sessions", "sess-norm"),
    });
    const before = database.db
      .prepare("SELECT data_dir FROM sessions WHERE id = ?")
      .get("sess-norm") as { data_dir: string };
    assert.equal(
      before.data_dir,
      path.join(storageRoot, "sessions", "sess-norm"),
    );

    // Construct with normalize → should rewrite the row in-line.
    createStorageContext(database, {
      storageRoot,
      normalizeStoredPaths: true,
    });

    const after = database.db
      .prepare("SELECT data_dir FROM sessions WHERE id = ?")
      .get("sess-norm") as { data_dir: string };
    assert.equal(after.data_dir, "sessions/sess-norm");
  } finally {
    database.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
