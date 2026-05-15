import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SqlRunner } from "./sql-runner.js";
import {
  createStorageContext,
  type StorageContext,
} from "./storage-context.js";
import { purgeSessions, previewSessionPurge } from "./session-purge.js";
import { DirongDatabase } from "./sqlite.js";

test("purgeSessions dry-run reports session rows without deleting them", () => {
  const fixture = createFixture();
  try {
    seedSession(fixture, fixture.sessionId, { writeAudioFiles: false });
    seedNotionPropertyRule(fixture);

    const result = previewSessionPurge({
      database: fixture.database,
      storageRoot: fixture.dir,
      selector: { kind: "sessions", sessionIds: [fixture.sessionId] },
    });

    assert.equal(result.dryRun, true);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.counts.sessions, 1);
    assert.equal(result.counts.chunks, 1);
    assert.equal(result.counts.sttJobs, 1);
    assert.equal(result.counts.connectionEvents, 1);
    assert.equal(result.counts.repairItems, 1);
    assert.equal(result.counts.notionCustomPropertyRules, 1);
    assert.equal(result.fileRetentionPlans.length, 1);
    assert.equal(result.fileRetentionPlans[0]?.targets.length, 2);
    assert.equal(result.fileRetentionResults.length, 0);
    assert.equal(countRows(fixture, "sessions"), 1);
  } finally {
    fixture.close();
  }
});

test("purgeSessions deletes session data while preserving Notion property rules", () => {
  const fixture = createFixture();
  try {
    const paths = seedSession(fixture, fixture.sessionId, { writeAudioFiles: true });
    seedNotionPropertyRule(fixture);

    const result = purgeSessions({
      database: fixture.database,
      storageRoot: fixture.dir,
      selector: { kind: "sessions", sessionIds: [fixture.sessionId] },
      dryRun: false,
    });

    assert.equal(result.dryRun, false);
    assert.equal(result.counts.sessions, 1);
    assert.equal(result.fileRetentionResults[0]?.deleted, 2);
    assert.equal(result.fileRetentionResults[0]?.missing, 0);
    assert.equal(existsSync(paths.rawAudioPath), false);
    assert.equal(existsSync(paths.sttAudioPath), false);
    assert.equal(countRows(fixture, "sessions"), 0);
    assert.equal(countRows(fixture, "session_speakers"), 0);
    assert.equal(countRows(fixture, "chunks"), 0);
    assert.equal(countRows(fixture, "stt_jobs"), 0);
    assert.equal(countRows(fixture, "connection_events"), 0);
    assert.equal(countRows(fixture, "repair_items"), 0);
    assert.equal(countRows(fixture, "notion_custom_property_rules"), 1);
  } finally {
    fixture.close();
  }
});

test("purgeSessions missing-audio selector targets only sessions with missing local files", () => {
  const fixture = createFixture();
  try {
    const missingSessionId = "meeting_missing_audio";
    const intactSessionId = "meeting_intact_audio";
    seedSession(fixture, missingSessionId, { writeAudioFiles: false });
    seedSession(fixture, intactSessionId, { writeAudioFiles: true });

    const result = purgeSessions({
      database: fixture.database,
      storageRoot: fixture.dir,
      selector: { kind: "missing-audio" },
      dryRun: true,
    });

    assert.deepEqual(
      result.candidates.map((candidate) => candidate.sessionId),
      [missingSessionId],
    );
    assert.equal(result.candidates[0]?.missingRawAudioCount, 1);
    assert.equal(result.candidates[0]?.missingSttAudioCount, 1);
    assert.equal(result.counts.sessions, 1);
  } finally {
    fixture.close();
  }
});

type PurgeFixture = {
  dir: string;
  database: DirongDatabase;
  ctx: StorageContext;
  sessionId: string;
  close: () => void;
};

function createFixture(): PurgeFixture {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-session-purge-"));
  const database = new DirongDatabase(path.join(dir, "dirong.sqlite"), 1000);
  const ctx = createStorageContext(database, {
    storageRoot: dir,
    normalizeStoredPaths: true,
  });
  return {
    dir,
    database,
    ctx,
    sessionId: "meeting_purge_test",
    close: () => {
      ctx.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function seedSession(
  fixture: PurgeFixture,
  sessionId: string,
  options: { writeAudioFiles: boolean },
): { rawAudioPath: string; sttAudioPath: string } {
  const sessionDir = path.join(fixture.dir, sessionId);
  const rawAudioPath = path.join(sessionDir, "chunks", "chunk.ogg");
  const sttAudioPath = path.join(sessionDir, "stt-audio", "chunk.webm");
  const chunkId = `${sessionId}_000001_speaker`;

  if (options.writeAudioFiles) {
    mkdirSync(path.dirname(rawAudioPath), { recursive: true });
    mkdirSync(path.dirname(sttAudioPath), { recursive: true });
    writeFileSync(rawAudioPath, "raw");
    writeFileSync(sttAudioPath, "stt");
  }

  fixture.ctx.writes.createSession({
    id: sessionId,
    guildId: "guild",
    guildName: "Guild",
    textChannelId: "text",
    voiceChannelId: "voice",
    voiceChannelName: "Voice",
    startedByUserId: "starter",
    startedByDisplayName: "Taniar",
    dataDir: sessionDir,
  });
  fixture.ctx.writes.upsertSpeaker({
    sessionId,
    userId: "speaker",
    displayNameSnapshot: "Taniar",
    isBot: false,
    seenAtMs: 0,
  });
  fixture.ctx.writes.createChunkWriting({
    chunkId,
    sessionId,
    chunkIndex: 1,
    userId: "speaker",
    displayNameSnapshot: "Taniar",
    startedAtMs: 0,
    rawAudioPath,
  });
  fixture.ctx.writes.finalizeRawChunk({
    chunkId,
    endedAtMs: 1000,
    durationMs: 1000,
    rawByteSize: 3,
    rawSha256: "raw-sha",
    closeReason: "test",
    pipelineError: null,
  });
  fixture.ctx.writes.completeChunkTranscodeAndQueueJob({
    chunkId,
    sttAudioPath,
    sttAudioFormat: "webm",
    sttByteSize: 3,
    sttSha256: "stt-sha",
    maxAttempts: 3,
  });
  fixture.ctx.writes.recordConnectionEvent({
    sessionId,
    eventType: "test_event",
  });
  fixture.ctx.writes.recordRepairItem({
    type: "test_repair",
    sessionId,
    chunkId,
    sttJobId: `stt_${chunkId}`,
    path: rawAudioPath,
  });

  return { rawAudioPath, sttAudioPath };
}

function seedNotionPropertyRule(fixture: PurgeFixture): void {
  const runner = new SqlRunner(fixture.database);
  runner.run(
    `INSERT INTO notion_custom_property_rules (
       property_name, property_type, enabled, prompt_description,
       created_at, updated_at
     ) VALUES ('프로젝트', 'rich_text', 1, '회의 프로젝트명', ?, ?)`,
    "2026-05-08T00:00:00.000Z",
    "2026-05-08T00:00:00.000Z",
  );
}

function countRows(fixture: PurgeFixture, tableName: string): number {
  const row = fixture.database.db.prepare(
    `SELECT COUNT(*) AS count FROM ${tableName}`,
  ).get() as { count: number };
  return row.count;
}
