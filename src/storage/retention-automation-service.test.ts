import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { RetentionPolicy } from "./file-retention.js";
import { RetentionAutomationService } from "./retention-automation-service.js";
import { DirongDatabase } from "./sqlite.js";

const nowIso = "2026-05-11T00:00:00.000Z";
const intervalMs = 6 * 60 * 60 * 1000;

type Fixture = {
  dir: string;
  database: DirongDatabase;
  close: () => void;
};

type SeededPaths = {
  rawAudioPath: string;
  sttAudioPath: string;
  aiPromptPath: string;
  draftMarkdownPath: string;
};

function createFixture(): Fixture {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-retention-auto-"));
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

function seedSessionArtifacts(
  fixture: Fixture,
  options: {
    sessionId: string;
    textCreatedAt: string;
  },
): SeededPaths {
  const sessionDir = path.join(fixture.dir, options.sessionId);
  const rawAudioPath = path.join(sessionDir, "chunks", "chunk.ogg");
  const sttAudioPath = path.join(sessionDir, "stt-audio", "chunk.webm");
  const aiDir = path.join(sessionDir, "ai-cleanup");
  const aiPromptPath = path.join(aiDir, "prompt.txt");
  const draftMarkdownPath = path.join(aiDir, "draft.md");
  const draftRawOutputPath = path.join(aiDir, "draft-raw.txt");
  const chunkId = `${options.sessionId}_000001_speaker`;
  const aiJobId = `${options.sessionId}_ai_job`;
  const draftId = `${options.sessionId}_draft`;

  mkdirSync(path.dirname(rawAudioPath), { recursive: true });
  mkdirSync(path.dirname(sttAudioPath), { recursive: true });
  mkdirSync(aiDir, { recursive: true });
  writeFileSync(rawAudioPath, "raw");
  writeFileSync(sttAudioPath, "stt");
  writeFileSync(path.join(aiDir, "timeline.json"), "{}");
  writeFileSync(path.join(aiDir, "timeline.md"), "# timeline");
  writeFileSync(aiPromptPath, "prompt");
  writeFileSync(path.join(aiDir, "raw.txt"), "raw output");
  writeFileSync(path.join(aiDir, "stderr.txt"), "stderr");
  writeFileSync(path.join(aiDir, "parsed.json"), "{}");
  writeFileSync(path.join(aiDir, "notes.md"), "# notes");
  writeFileSync(path.join(aiDir, "draft.json"), "{}");
  writeFileSync(draftMarkdownPath, "# draft");
  writeFileSync(draftRawOutputPath, "draft raw output");

  fixture.database.db
    .prepare(
      `INSERT INTO sessions (
         id, guild_id, guild_name, text_channel_id, voice_channel_id,
         voice_channel_name, started_by_user_id, started_by_display_name,
         stopped_by_user_id, stopped_by_display_name, status, started_at,
         stopped_at, finalized_at, data_dir, last_error, created_at, updated_at
       ) VALUES (
         ?, 'guild', 'Guild', 'text', 'voice', 'Voice', 'starter', 'Taniar',
         NULL, NULL, 'finalized', ?, ?, ?, ?, NULL, ?, ?
       )`,
    )
    .run(
      options.sessionId,
      nowIso,
      nowIso,
      nowIso,
      sessionDir,
      nowIso,
      nowIso,
    );
  fixture.database.db
    .prepare(
      `INSERT INTO session_speakers (
         session_id, user_id, display_name_snapshot, is_bot,
         first_seen_at_ms, first_seen_at, last_seen_at_ms, last_seen_at,
         chunk_count
       ) VALUES (?, 'speaker', 'Taniar', 0, 0, ?, 0, ?, 1)`,
    )
    .run(options.sessionId, nowIso, nowIso);
  fixture.database.db
    .prepare(
      `INSERT INTO chunks (
         id, session_id, chunk_index, user_id, display_name_snapshot, status,
         started_at_ms, ended_at_ms, duration_ms, raw_audio_path,
         raw_audio_format, raw_byte_size, raw_sha256, stt_audio_path,
         stt_audio_format, stt_byte_size, stt_sha256, transcode_status,
         created_at, updated_at
       ) VALUES (
         ?, ?, 1, 'speaker', 'Taniar', 'ready_for_stt', 0, 1000, 1000,
         ?, 'ogg', 3, 'raw-sha', ?, 'webm', 3, 'stt-sha', 'done', ?, ?
       )`,
    )
    .run(chunkId, options.sessionId, rawAudioPath, sttAudioPath, nowIso, nowIso);
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
         ?, ?, 'done', 1, 3, NULL, NULL, ?, 'claude', 'sonnet', NULL,
         'prompt-v1', 'timeline-v1', 'input-hash', 1,
         ?, ?, ?, ?, ?, ?, ?, 'output-hash', NULL, NULL, ?, ?
       )`,
    )
    .run(
      aiJobId,
      options.sessionId,
      nowIso,
      path.join(aiDir, "timeline.json"),
      path.join(aiDir, "timeline.md"),
      aiPromptPath,
      path.join(aiDir, "raw.txt"),
      path.join(aiDir, "stderr.txt"),
      path.join(aiDir, "parsed.json"),
      path.join(aiDir, "notes.md"),
      options.textCreatedAt,
      options.textCreatedAt,
    );
  fixture.database.db
    .prepare(
      `INSERT INTO meeting_notes_drafts (
         id, session_id, ai_cleanup_job_id, schema_version, language, title,
         summary_text, draft_json, markdown, json_path, markdown_path,
         raw_output_path, provider, model, prompt_version, input_hash,
         output_hash, validation_status, created_at, updated_at
       ) VALUES (
         ?, ?, ?, 'v1', 'ko', '회의', '요약', '{}', '# 회의록',
         ?, ?, ?, 'claude', 'sonnet', 'prompt-v1', 'input-hash',
         'output-hash', 'valid', ?, ?
       )`,
    )
    .run(
      draftId,
      options.sessionId,
      aiJobId,
      path.join(aiDir, "draft.json"),
      draftMarkdownPath,
      draftRawOutputPath,
      options.textCreatedAt,
      options.textCreatedAt,
    );

  return { rawAudioPath, sttAudioPath, aiPromptPath, draftMarkdownPath };
}

function makePolicy(textDraftRetentionDays: number): RetentionPolicy {
  return { deleteAudioAfterNotionUpload: true, textDraftRetentionDays };
}

test("runOnce deletes expired text/draft artifacts and keeps recent ones and audio", async () => {
  const fixture = createFixture();
  try {
    const oldPaths = seedSessionArtifacts(fixture, {
      sessionId: "meeting_old_text",
      textCreatedAt: "2026-03-01T00:00:00.000Z",
    });
    const recentPaths = seedSessionArtifacts(fixture, {
      sessionId: "meeting_recent_text",
      textCreatedAt: "2026-05-01T00:00:00.000Z",
    });

    const service = new RetentionAutomationService({
      database: fixture.database,
      storageRoot: fixture.dir,
      getRetentionPolicy: () => makePolicy(30),
      intervalMs,
      now: () => new Date(nowIso),
    });

    const snapshot = await service.runOnce();

    assert.equal(snapshot.status, "done");
    assert.equal(snapshot.lastSweepSessions, 1);
    assert.equal(snapshot.lastSweepDeletedFiles, 10);
    assert.equal(snapshot.technicalDetail, null);
    // 만료된 세션의 텍스트·초안 파일은 실제로 삭제된다.
    assert.equal(existsSync(oldPaths.aiPromptPath), false);
    assert.equal(existsSync(oldPaths.draftMarkdownPath), false);
    // audio는 expired-text-artifacts 경로 대상이 아니므로 보존된다.
    assert.equal(existsSync(oldPaths.rawAudioPath), true);
    assert.equal(existsSync(oldPaths.sttAudioPath), true);
    // cutoff 이후(최근) 세션의 텍스트·초안은 보존된다.
    assert.equal(existsSync(recentPaths.aiPromptPath), true);
    assert.equal(existsSync(recentPaths.draftMarkdownPath), true);
  } finally {
    fixture.close();
  }
});

test("getRetentionPolicy is read each tick so a changed retention period is applied", async () => {
  const fixture = createFixture();
  try {
    const paths = seedSessionArtifacts(fixture, {
      sessionId: "meeting_text",
      textCreatedAt: "2026-05-01T00:00:00.000Z",
    });
    // 가변 정책: 첫 tick은 30일(만료 아님), 두 번째 tick은 7일(만료됨).
    let days = 30;
    const service = new RetentionAutomationService({
      database: fixture.database,
      storageRoot: fixture.dir,
      getRetentionPolicy: () => makePolicy(days),
      intervalMs,
      now: () => new Date(nowIso),
    });

    const first = await service.runOnce();
    assert.equal(first.lastSweepDeletedFiles, 0);
    assert.equal(existsSync(paths.aiPromptPath), true);

    days = 7;
    const second = await service.runOnce();
    assert.equal(second.lastSweepDeletedFiles, 10);
    assert.equal(second.status, "done");
    assert.equal(existsSync(paths.aiPromptPath), false);
  } finally {
    fixture.close();
  }
});

test("runOnce skips the sweep while recording is active", async () => {
  const fixture = createFixture();
  try {
    const paths = seedSessionArtifacts(fixture, {
      sessionId: "meeting_old_text",
      textCreatedAt: "2026-03-01T00:00:00.000Z",
    });
    const service = new RetentionAutomationService({
      database: fixture.database,
      storageRoot: fixture.dir,
      getRetentionPolicy: () => makePolicy(30),
      intervalMs,
      isRecording: () => true,
      now: () => new Date(nowIso),
    });

    const snapshot = await service.runOnce();

    assert.equal(snapshot.status, "idle");
    assert.equal(snapshot.lastSweepDeletedFiles, 0);
    assert.equal(snapshot.lastSweepSessions, 0);
    // 녹음 중에는 아무 파일도 삭제하지 않는다.
    assert.equal(existsSync(paths.aiPromptPath), true);
  } finally {
    fixture.close();
  }
});

test("runOnce surfaces deletion failures as status 'failed' without swallowing", async () => {
  if (process.platform === "win32") {
    // Windows에서는 chmod로 파일 삭제를 막을 수 없어 실패 케이스를 재현할 수 없다.
    return;
  }
  const fixture = createFixture();
  try {
    const paths = seedSessionArtifacts(fixture, {
      sessionId: "meeting_old_text",
      textCreatedAt: "2026-03-01T00:00:00.000Z",
    });
    // 파일이 든 디렉터리를 읽기전용으로 만들어 unlink를 실패시킨다.
    const lockedDir = path.dirname(paths.aiPromptPath);
    chmodSync(lockedDir, 0o500);
    try {
      const service = new RetentionAutomationService({
        database: fixture.database,
        storageRoot: fixture.dir,
        getRetentionPolicy: () => makePolicy(30),
        intervalMs,
        now: () => new Date(nowIso),
      });

      const snapshot = await service.runOnce();

      assert.equal(snapshot.status, "failed");
      assert.ok(snapshot.technicalDetail);
      assert.match(snapshot.technicalDetail ?? "", /error=/);
    } finally {
      chmodSync(lockedDir, 0o700);
    }
  } finally {
    fixture.close();
  }
});
