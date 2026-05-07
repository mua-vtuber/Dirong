import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createStoragePathResolver } from "./path-resolver.js";
import { SessionStore } from "./session-store.js";
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

test("SessionStore stores new audio paths relative and resolves reads", () => {
  const fixture = createFixture();
  try {
    const store = new SessionStore(fixture.database, {
      storageRoot: fixture.dir,
      normalizeStoredPaths: true,
    });
    const paths = seedSessionWithAudio(store, fixture.dir);

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

    assert.equal(store.getSession(paths.sessionId)?.data_dir, paths.sessionDir);
    assert.equal(
      store.getAudioPathForChunk(paths.chunkId, "stt")?.path,
      paths.sttAudioPath,
    );
    assert.equal(store.hasChunkAudioPath(paths.rawAudioPath), true);
  } finally {
    fixture.close();
  }
});

test("SessionStore normalizes existing absolute path rows under the storage root", () => {
  const fixture = createFixture();
  try {
    const legacyStore = new SessionStore(fixture.database);
    const paths = seedSessionWithAudio(legacyStore, fixture.dir);
    legacyStore.recordRepairItem({
      type: "path_test",
      sessionId: paths.sessionId,
      chunkId: paths.chunkId,
      path: paths.rawAudioPath,
      severity: "warn",
    });

    assert.equal(readScalar(fixture, "SELECT data_dir FROM sessions"), paths.sessionDir);
    assert.equal(readScalar(fixture, "SELECT raw_audio_path FROM chunks"), paths.rawAudioPath);

    const normalizedStore = new SessionStore(fixture.database, {
      storageRoot: fixture.dir,
      normalizeStoredPaths: true,
    });

    assert.equal(readScalar(fixture, "SELECT data_dir FROM sessions"), paths.sessionId);
    assert.equal(
      readScalar(fixture, "SELECT raw_audio_path FROM chunks"),
      `${paths.sessionId}/chunks/chunk.ogg`,
    );
    assert.equal(
      normalizedStore.getAudioPathForChunk(paths.chunkId, "raw")?.path,
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

test("SessionStore stores AI cleanup artifact paths relative and resolves reads", () => {
  const fixture = createFixture();
  try {
    const store = new SessionStore(fixture.database, {
      storageRoot: fixture.dir,
      normalizeStoredPaths: true,
    });
    const paths = seedSessionWithAudio(store, fixture.dir);
    const aiDir = path.join(paths.sessionDir, "ai-cleanup");
    const timelineJsonPath = path.join(aiDir, "timeline.json");
    const timelineMarkdownPath = path.join(aiDir, "timeline.md");
    const promptPath = path.join(aiDir, "prompt.txt");
    const rawOutputPath = path.join(aiDir, "raw-output.jsonl");
    const stderrPath = path.join(aiDir, "stderr.txt");
    const parsedJsonPath = path.join(aiDir, "draft.json");
    const markdownPath = path.join(aiDir, "draft.md");

    const job = store.getOrCreateAiCleanupJob({
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
    store.updateAiCleanupJobArtifacts({
      jobId: job.id,
      promptPath,
      rawOutputPath,
      stderrPath,
      parsedJsonPath,
      markdownPath,
      outputHash: "output-hash",
    });
    store.completeAiCleanupJob({
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

    assert.equal(store.getAiCleanupJob(job.id)?.prompt_path, promptPath);
    assert.equal(
      store.getLatestMeetingNotesDraft(paths.sessionId)?.markdown_path,
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

function seedSessionWithAudio(store: SessionStore, root: string): SeededPaths {
  const sessionId = "meeting_path_test";
  const sessionDir = path.join(root, sessionId);
  const chunkId = `${sessionId}_000001_speaker`;
  const rawAudioPath = path.join(sessionDir, "chunks", "chunk.ogg");
  const sttAudioPath = path.join(sessionDir, "stt-audio", "chunk.webm");

  store.createSession({
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
    rawAudioPath,
  });
  store.finalizeRawChunk({
    chunkId,
    endedAtMs: 1000,
    durationMs: 1000,
    rawByteSize: 10,
    rawSha256: "raw-sha",
    closeReason: "test",
    pipelineError: null,
  });
  store.completeChunkTranscodeAndQueueJob({
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
