import assert from "node:assert/strict";
import { closeSync, existsSync, mkdtempSync, openSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createStorageContext,
  flattenStorageContext,
} from "../storage/storage-context.js";
import { DirongDatabase } from "../storage/sqlite.js";
import { backupDatabaseSnapshot } from "../storage/sqlite-backup.js";

test("backupDatabaseSnapshot creates a single sqlite snapshot", () => {
  const fixture = createQueuedJobFixture();
  try {
    const paths = backupDatabaseSnapshot(fixture.dbPath, {
      busyTimeoutMs: 1000,
    });

    assert.equal(paths.length, 1);
    assert.match(paths[0] ?? "", /\.sqlite$/);
    assert.ok(existsSync(path.resolve(paths[0] ?? "")));
  } finally {
    fixture.close();
  }
});

test("backup failure leaves queued job attempts unchanged before STT claim", () => {
  const fixture = createQueuedJobFixture();
  const existingTarget = path.join(fixture.dir, "already-exists.sqlite");
  closeSync(openSync(existingTarget, "w"));

  try {
    assert.deepEqual(fixture.readQueuedAttemptSummary(), {
      queued: 1,
      attempts: 0,
    });
    assert.throws(
      () =>
        backupDatabaseSnapshot(fixture.dbPath, {
          busyTimeoutMs: 1000,
          targetPath: existingTarget,
        }),
      /SQLite backup target already exists/,
    );
    assert.deepEqual(fixture.readQueuedAttemptSummary(), {
      queued: 1,
      attempts: 0,
    });
  } finally {
    fixture.close();
  }
});

function createQueuedJobFixture(): {
  dir: string;
  dbPath: string;
  close: () => void;
  readQueuedAttemptSummary: () => { queued: number; attempts: number };
} {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-backup-"));
  const dbPath = path.join(dir, "dirong.sqlite");
  const database = new DirongDatabase(dbPath, 1000);
  const ctx = createStorageContext(database);
  const store = flattenStorageContext(ctx);
  const sessionId = "meeting_backup_test";
  const chunkId = `${sessionId}_000001_speaker`;

  store.createSession({
    id: sessionId,
    guildId: "guild",
    guildName: "Guild",
    textChannelId: "text",
    voiceChannelId: "voice",
    voiceChannelName: "Voice",
    startedByUserId: "user",
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
  store.createChunkWriting({
    chunkId,
    sessionId,
    chunkIndex: 1,
    userId: "speaker",
    displayNameSnapshot: "Taniar",
    startedAtMs: 0,
    rawAudioPath: path.join(dir, "chunk.ogg"),
  });
  store.finalizeRawChunk({
    chunkId,
    endedAtMs: 1000,
    durationMs: 1000,
    rawByteSize: 10,
    rawSha256: "raw",
    closeReason: "test",
    pipelineError: null,
  });
  store.completeChunkTranscodeAndQueueJob({
    chunkId,
    sttAudioPath: path.join(dir, "chunk.webm"),
    sttAudioFormat: "webm",
    sttByteSize: 10,
    sttSha256: "stt",
    maxAttempts: 3,
  });

  return {
    dir,
    dbPath,
    close: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
    readQueuedAttemptSummary: () => {
      const row = database.db.prepare(
        "SELECT COUNT(*) AS queued, COALESCE(SUM(attempts), 0) AS attempts FROM stt_jobs WHERE status = 'queued'",
      ).get() as { queued: number; attempts: number };
      return {
        queued: row.queued,
        attempts: row.attempts,
      };
    },
  };
}
