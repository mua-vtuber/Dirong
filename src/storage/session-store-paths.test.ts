import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createStoragePathResolver } from "./path-resolver.js";
import {
  createStorageContext,
  type StorageContext,
} from "./storage-context.js";
import { DirongDatabase } from "./sqlite.js";

test("storage path resolver stores root-local paths as portable relative paths", () => {
  const root = path.resolve(os.tmpdir(), "dirong-path-root");
  const resolver = createStoragePathResolver(root);
  const inside = path.join(root, "meeting_1", "chunks", "chunk.ogg");
  const outside = path.resolve(os.tmpdir(), "outside-dirong", "chunk.ogg");

  assert.equal(resolver.toStoredPath(inside), "meeting_1/chunks/chunk.ogg");
  assert.equal(resolver.resolveStoredPath("meeting_1/chunks/chunk.ogg"), inside);
  assert.equal(resolver.toStoredPath(outside), outside);
  assert.equal(resolver.resolveStoredPath(outside), outside);
});

test("StorageContext stores new audio paths relative and resolves reads", () => {
  const fixture = createFixture();
  try {
    const ctx = createStorageContext(fixture.database, {
      storageRoot: fixture.dir,
      normalizeStoredPaths: true,
    });
    const paths = seedSessionWithAudio(ctx, fixture.dir);

    assert.equal(readScalar(fixture, "SELECT data_dir FROM sessions"), paths.sessionId);
    assert.equal(
      readScalar(fixture, "SELECT raw_audio_path FROM chunks"),
      `${paths.sessionId}/chunks/chunk.ogg`,
    );
    assert.equal(
      readScalar(fixture, "SELECT stt_audio_path FROM chunks"),
      `${paths.sessionId}/stt-audio/chunk.webm`,
    );
    assert.equal(
      readScalar(fixture, "SELECT input_audio_path FROM stt_jobs"),
      `${paths.sessionId}/stt-audio/chunk.webm`,
    );

    assert.equal(ctx.reads.getSession(paths.sessionId)?.data_dir, paths.sessionDir);
    assert.equal(
      ctx.reads.getAudioPathForChunk(paths.chunkId, "stt")?.path,
      paths.sttAudioPath,
    );
    assert.equal(ctx.reads.hasChunkAudioPath(paths.rawAudioPath), true);
  } finally {
    fixture.close();
  }
});

test("StorageContext status text localizes primary recording state", () => {
  const fixture = createFixture();
  try {
    const ctx = createStorageContext(fixture.database, {
      storageRoot: fixture.dir,
      normalizeStoredPaths: true,
    });
    const paths = seedSessionWithAudio(ctx, fixture.dir);
    const runtime = {
      isRecording: true,
      sessionId: paths.sessionId,
      guildId: "guild",
      voiceChannelId: "voice",
      voiceChannelName: "Voice",
      openChunks: 0,
    };

    const english = ctx.reads.statusText(runtime, "http://127.0.0.1:3095/", "en");
    const korean = ctx.reads.statusText(runtime, "http://127.0.0.1:3095/", "ko");

    assert.match(
      english,
      /Recording and STT status: The recording session has been created\. \(created\)/,
    );
    assert.match(english, /STT queue: Waiting\(queued\):1/);
    assert.match(
      korean,
      /녹음과 STT 상태: 녹음 세션이 만들어졌습니다\. \(created\)/,
    );
    assert.match(korean, /STT 대기열: 대기 중\(queued\):1/);
  } finally {
    fixture.close();
  }
});

test("StorageContext normalizes existing absolute path rows under the storage root", () => {
  const fixture = createFixture();
  try {
    const legacyCtx = createStorageContext(fixture.database);
    const paths = seedSessionWithAudio(legacyCtx, fixture.dir);
    legacyCtx.writes.recordRepairItem({
      type: "path_test",
      sessionId: paths.sessionId,
      chunkId: paths.chunkId,
      path: paths.rawAudioPath,
      severity: "warn",
    });

    assert.equal(readScalar(fixture, "SELECT data_dir FROM sessions"), paths.sessionDir);
    assert.equal(readScalar(fixture, "SELECT raw_audio_path FROM chunks"), paths.rawAudioPath);

    const normalizedCtx = createStorageContext(fixture.database, {
      storageRoot: fixture.dir,
      normalizeStoredPaths: true,
    });

    assert.equal(readScalar(fixture, "SELECT data_dir FROM sessions"), paths.sessionId);
    assert.equal(
      readScalar(fixture, "SELECT raw_audio_path FROM chunks"),
      `${paths.sessionId}/chunks/chunk.ogg`,
    );
    assert.equal(
      normalizedCtx.reads.getAudioPathForChunk(paths.chunkId, "raw")?.path,
      paths.rawAudioPath,
    );
    assert.equal(
      readScalar(fixture, "SELECT path FROM repair_items WHERE item_type = 'path_test'"),
      `${paths.sessionId}/chunks/chunk.ogg`,
    );
    assert.equal(
      readScalar(
        fixture,
        "SELECT dedupe_key FROM repair_items WHERE item_type = 'path_test'",
      ),
      `path_test:${paths.sessionId}:${paths.sessionId}/chunks/chunk.ogg:${paths.chunkId}:`,
    );
  } finally {
    fixture.close();
  }
});

test("StorageContext stores AI cleanup artifact paths relative and resolves reads", () => {
  const fixture = createFixture();
  try {
    const ctx = createStorageContext(fixture.database, {
      storageRoot: fixture.dir,
      normalizeStoredPaths: true,
    });
    const paths = seedSessionWithAudio(ctx, fixture.dir);
    const aiDir = path.join(paths.sessionDir, "ai-cleanup");
    const timelineJsonPath = path.join(aiDir, "timeline.json");
    const timelineMarkdownPath = path.join(aiDir, "timeline.md");
    const promptPath = path.join(aiDir, "prompt.txt");
    const rawOutputPath = path.join(aiDir, "raw-output.jsonl");
    const stderrPath = path.join(aiDir, "stderr.txt");
    const parsedJsonPath = path.join(aiDir, "draft.json");
    const markdownPath = path.join(aiDir, "draft.md");

    const job = ctx.jobs.getOrCreateAiCleanupJob({
      id: "ai_path_job",
      sessionId: paths.sessionId,
      provider: "fake",
      model: "fixture-model",
      command: null,
      promptVersion: "phase4-fixture",
      inputContractVersion: "timeline-fixture",
      inputHash: "input-hash",
      inputEntryCount: 1,
      inputTimelineJsonPath: timelineJsonPath,
      inputTimelineMarkdownPath: timelineMarkdownPath,
      maxAttempts: 3,
    });
    ctx.jobs.updateAiCleanupJobArtifacts({
      jobId: job.id,
      promptPath,
      rawOutputPath,
      stderrPath,
      parsedJsonPath,
      markdownPath,
      outputHash: "output-hash",
    });
    ctx.writes.completeAiCleanupJob({
      jobId: job.id,
      draftId: "draft_path_job",
      schemaVersion: "meeting-notes-draft-v1",
      language: "ko",
      title: "회의록",
      summaryText: "요약",
      draftJson: "{}",
      markdown: "# 회의록",
      jsonPath: parsedJsonPath,
      markdownPath,
      rawOutputPath,
      provider: "fake",
      model: "fixture-model",
      promptVersion: "phase4-fixture",
      inputHash: "input-hash",
      outputHash: "output-hash",
    });

    assert.equal(
      readScalar(fixture, "SELECT input_timeline_json_path FROM ai_cleanup_jobs"),
      `${paths.sessionId}/ai-cleanup/timeline.json`,
    );
    assert.equal(
      readScalar(fixture, "SELECT prompt_path FROM ai_cleanup_jobs"),
      `${paths.sessionId}/ai-cleanup/prompt.txt`,
    );
    assert.equal(
      readScalar(fixture, "SELECT json_path FROM meeting_notes_drafts"),
      `${paths.sessionId}/ai-cleanup/draft.json`,
    );

    assert.equal(ctx.reads.getAiCleanupJob(job.id)?.prompt_path, promptPath);
    assert.equal(
      ctx.reads.getLatestMeetingNotesDraft(paths.sessionId)?.markdown_path,
      markdownPath,
    );
  } finally {
    fixture.close();
  }
});

type PathFixture = {
  dir: string;
  database: DirongDatabase;
  close: () => void;
};

type SeededPaths = {
  sessionId: string;
  sessionDir: string;
  chunkId: string;
  rawAudioPath: string;
  sttAudioPath: string;
};

function createFixture(): PathFixture {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-store-paths-"));
  const database = new DirongDatabase(path.join(dir, "dirong.sqlite"), 1000);
  return {
    dir,
    database,
    close: () => {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function seedSessionWithAudio(ctx: StorageContext, root: string): SeededPaths {
  const sessionId = "meeting_path_test";
  const sessionDir = path.join(root, sessionId);
  const chunkId = `${sessionId}_000001_speaker`;
  const rawAudioPath = path.join(sessionDir, "chunks", "chunk.ogg");
  const sttAudioPath = path.join(sessionDir, "stt-audio", "chunk.webm");

  ctx.writes.createSession({
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
  ctx.writes.upsertSpeaker({
    sessionId,
    userId: "speaker",
    displayNameSnapshot: "Taniar",
    isBot: false,
    seenAtMs: 0,
  });
  ctx.writes.createChunkWriting({
    chunkId,
    sessionId,
    chunkIndex: 1,
    userId: "speaker",
    displayNameSnapshot: "Taniar",
    startedAtMs: 0,
    rawAudioPath,
  });
  ctx.writes.finalizeRawChunk({
    chunkId,
    endedAtMs: 1000,
    durationMs: 1000,
    rawByteSize: 10,
    rawSha256: "raw-sha",
    closeReason: "test",
    pipelineError: null,
  });
  ctx.writes.completeChunkTranscodeAndQueueJob({
    chunkId,
    sttAudioPath,
    sttAudioFormat: "webm",
    sttByteSize: 10,
    sttSha256: "stt-sha",
    maxAttempts: 3,
  });

  return { sessionId, sessionDir, chunkId, rawAudioPath, sttAudioPath };
}

function readScalar(fixture: PathFixture, sql: string): string | null {
  const row = fixture.database.db.prepare(sql).get() as
    | Record<string, string | null>
    | undefined;
  if (!row) {
    return null;
  }
  const [value] = Object.values(row);
  return value ?? null;
}
