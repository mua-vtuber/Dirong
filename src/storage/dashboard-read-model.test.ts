import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { RecordingRuntimeState } from "./storage-context.js";
import {
  createStorageContext,
  type StorageContext,
} from "./storage-context.js";
import { DirongDatabase } from "./sqlite.js";

test("SessionStore dashboard read model returns current session slices", () => {
  const fixture = createFixture();
  try {
    seedDashboardSession(fixture);
    const runtime: RecordingRuntimeState = {
      isRecording: false,
      sessionId: fixture.sessionId,
      voiceChannelId: null,
      voiceChannelName: null,
      openChunks: 0,
    };

    const state = fixture.ctx.reads.getDashboardState(runtime) as {
      currentSession?: { id: string };
      speakers?: Array<{ user_id: string }>;
      recentChunks?: Array<{ id: string; stt_job_id: string }>;
      recentSttJobs?: Array<{ id: string; status: string }>;
      queueStats?: Array<{ status: string; count: number }>;
    };

    assert.equal(state.currentSession?.id, fixture.sessionId);
    assert.equal(state.speakers?.[0]?.user_id, "speaker");
    assert.equal(state.recentChunks?.[0]?.id, fixture.chunkId);
    assert.equal(state.recentChunks?.[0]?.stt_job_id, `stt_${fixture.chunkId}`);
    assert.equal(state.recentSttJobs?.[0]?.status, "queued");
    assert.deepEqual(state.queueStats, [{ status: "queued", count: 1 }]);
  } finally {
    fixture.close();
  }
});

test("SessionStore dashboard read model returns latest Notion write without secrets", () => {
  const fixture = createFixture();
  try {
    seedDashboardSession(fixture);
    seedNotionWrite(fixture);
    const runtime: RecordingRuntimeState = {
      isRecording: false,
      sessionId: fixture.sessionId,
      voiceChannelId: null,
      voiceChannelName: null,
      openChunks: 0,
    };

    const state = fixture.ctx.reads.getDashboardState(runtime) as {
      latestNotionWrite?: {
        id: string;
        status: string;
        notion_page_url: string;
        last_error: string | null;
      };
    };
    const serialized = JSON.stringify(state);

    assert.equal(state.latestNotionWrite?.id, "notion-write-dashboard");
    assert.equal(state.latestNotionWrite?.status, "done");
    assert.equal(
      state.latestNotionWrite?.notion_page_url,
      "https://notion.so/page",
    );
    assert.doesNotMatch(serialized, /ntn_/);
  } finally {
    fixture.close();
  }
});

type DashboardFixture = {
  dir: string;
  database: DirongDatabase;
  ctx: StorageContext;
  sessionId: string;
  chunkId: string;
  close: () => void;
};

function createFixture(): DashboardFixture {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-dashboard-read-"));
  const database = new DirongDatabase(path.join(dir, "dirong.sqlite"), 1000);
  const ctx = createStorageContext(database);
  const sessionId = "meeting_dashboard_read";
  const chunkId = `${sessionId}_000001_speaker`;
  return {
    dir,
    database,
    ctx,
    sessionId,
    chunkId,
    close: () => {
      ctx.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function seedDashboardSession(fixture: DashboardFixture): void {
  fixture.ctx.writes.createSession({
    id: fixture.sessionId,
    guildId: "guild",
    guildName: "Guild",
    textChannelId: "text",
    voiceChannelId: "voice",
    voiceChannelName: "Voice",
    startedByUserId: "starter",
    startedByDisplayName: "Taniar",
    dataDir: fixture.dir,
  });
  fixture.ctx.writes.upsertSpeaker({
    sessionId: fixture.sessionId,
    userId: "speaker",
    displayNameSnapshot: "Taniar",
    isBot: false,
    seenAtMs: 0,
  });
  fixture.ctx.writes.createChunkWriting({
    chunkId: fixture.chunkId,
    sessionId: fixture.sessionId,
    chunkIndex: 1,
    userId: "speaker",
    displayNameSnapshot: "Taniar",
    startedAtMs: 0,
    rawAudioPath: path.join(fixture.dir, "chunk.ogg"),
  });
  fixture.ctx.writes.finalizeRawChunk({
    chunkId: fixture.chunkId,
    endedAtMs: 1000,
    durationMs: 1000,
    rawByteSize: 10,
    rawSha256: "raw-sha",
    closeReason: "test",
    pipelineError: null,
  });
  fixture.ctx.writes.completeChunkTranscodeAndQueueJob({
    chunkId: fixture.chunkId,
    sttAudioPath: path.join(fixture.dir, "chunk.webm"),
    sttAudioFormat: "webm",
    sttByteSize: 10,
    sttSha256: "stt-sha",
    maxAttempts: 3,
  });
}

function seedNotionWrite(fixture: DashboardFixture): void {
  const now = "2026-05-07T00:00:00.000Z";
  fixture.database.db
    .prepare(
      `INSERT INTO ai_cleanup_jobs (
         id, session_id, status, attempts, max_attempts, locked_by,
         locked_until, next_attempt_at, provider, model, command,
         prompt_version, input_contract_version, input_hash, input_entry_count,
         input_timeline_json_path, input_timeline_markdown_path, prompt_path,
         raw_output_path, stderr_path, parsed_json_path, markdown_path,
         output_hash, failure_kind, last_error, created_at, updated_at
       ) VALUES (
         'ai-dashboard', ?, 'done', 1, 3, NULL, NULL, ?, 'fake', 'model',
         NULL, 'prompt-v1', 'timeline-v1', 'input-hash-dashboard', 1,
         NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'output-hash',
         NULL, NULL, ?, ?
       )`,
    )
    .run(fixture.sessionId, now, now, now);
  fixture.database.db
    .prepare(
      `INSERT INTO meeting_notes_drafts (
         id, session_id, ai_cleanup_job_id, schema_version, language, title,
         summary_text, draft_json, markdown, json_path, markdown_path,
         raw_output_path, provider, model, prompt_version, input_hash,
         output_hash, validation_status, created_at, updated_at
       ) VALUES (
         'draft-dashboard', ?, 'ai-dashboard', 'v1', 'ko', '회의록', '요약',
         '{}', '# 회의록', 'draft.json', 'draft.md', 'raw.txt', 'fake',
         'model', 'prompt-v1', 'input-hash', 'output-hash', 'valid', ?, ?
       )`,
    )
    .run(fixture.sessionId, now, now);
  fixture.database.db
    .prepare(
      `INSERT INTO notion_writes (
         id, session_id, draft_id, target_type, target_id, target_url,
         notion_page_id, notion_page_url, content_hash, status,
         status_message, attempts, max_attempts, next_attempt_at, last_error,
         created_at, updated_at
       ) VALUES (
         'notion-write-dashboard', ?, 'draft-dashboard', 'data_source',
         'target-dashboard', 'https://notion.so/db', 'page-dashboard',
         'https://notion.so/page', 'hash-dashboard', 'done',
         'complete', 1, 3, ?, NULL, ?, ?
       )`,
    )
    .run(fixture.sessionId, now, now, now);
}
