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
import {
  buildExpiredTextArtifactDeletionPlans,
  buildRetentionDeletionPlan,
  executeRetentionDeletionPlan,
  type RetentionPolicy,
} from "./file-retention.js";
import { DirongDatabase } from "./sqlite.js";

const nowIso = "2026-05-11T00:00:00.000Z";
const defaultPolicy: RetentionPolicy = {
  deleteAudioAfterNotionUpload: true,
  textDraftRetentionDays: 30,
};

test("buildRetentionDeletionPlan previews Notion audio deletion without deleting files", () => {
  const fixture = createFixture();
  try {
    const paths = seedSessionArtifacts(fixture, {
      sessionId: fixture.sessionId,
      writeAudioFiles: true,
    });

    const plan = buildRetentionDeletionPlan({
      database: fixture.database,
      storageRoot: fixture.dir,
      sessionId: fixture.sessionId,
      policy: defaultPolicy,
      reason: "notion-upload-success",
      nowIso,
    });

    assert.deepEqual(
      plan.targets.map((target) => target.kind),
      ["raw_audio", "stt_audio"],
    );
    assert.equal(plan.targets.every((target) => target.exists), true);
    assert.equal(existsSync(paths.rawAudioPath), true);
    assert.equal(existsSync(paths.sttAudioPath), true);
  } finally {
    fixture.close();
  }
});

test("executeRetentionDeletionPlan deletes raw and STT audio after Notion success", () => {
  const fixture = createFixture();
  try {
    const paths = seedSessionArtifacts(fixture, {
      sessionId: fixture.sessionId,
      writeAudioFiles: true,
    });
    const plan = buildRetentionDeletionPlan({
      database: fixture.database,
      storageRoot: fixture.dir,
      sessionId: fixture.sessionId,
      policy: defaultPolicy,
      reason: "notion-upload-success",
      nowIso,
    });

    const result = executeRetentionDeletionPlan(plan);

    assert.equal(result.deleted, 2);
    assert.equal(result.missing, 0);
    assert.equal(result.failed, 0);
    assert.equal(existsSync(paths.rawAudioPath), false);
    assert.equal(existsSync(paths.sttAudioPath), false);
  } finally {
    fixture.close();
  }
});

test("Notion audio retention policy false preserves audio files", () => {
  const fixture = createFixture();
  try {
    const paths = seedSessionArtifacts(fixture, {
      sessionId: fixture.sessionId,
      writeAudioFiles: true,
    });
    const plan = buildRetentionDeletionPlan({
      database: fixture.database,
      storageRoot: fixture.dir,
      sessionId: fixture.sessionId,
      policy: { ...defaultPolicy, deleteAudioAfterNotionUpload: false },
      reason: "notion-upload-success",
      nowIso,
    });

    const result = executeRetentionDeletionPlan(plan);

    assert.equal(plan.targets.length, 0);
    assert.equal(result.deleted, 0);
    assert.equal(existsSync(paths.rawAudioPath), true);
    assert.equal(existsSync(paths.sttAudioPath), true);
  } finally {
    fixture.close();
  }
});

test("missing retention targets are reported as successful missing outcomes", () => {
  const fixture = createFixture();
  try {
    seedSessionArtifacts(fixture, {
      sessionId: fixture.sessionId,
      writeAudioFiles: false,
    });
    const plan = buildRetentionDeletionPlan({
      database: fixture.database,
      storageRoot: fixture.dir,
      sessionId: fixture.sessionId,
      policy: defaultPolicy,
      reason: "notion-upload-success",
      nowIso,
    });

    const result = executeRetentionDeletionPlan(plan);

    assert.equal(result.deleted, 0);
    assert.equal(result.missing, 2);
    assert.equal(result.failed, 0);
    assert.deepEqual(
      result.results.map((item) => item.status),
      ["missing", "missing"],
    );
  } finally {
    fixture.close();
  }
});

test("retention deletion fails hard before deleting any path outside data root", () => {
  const fixture = createFixture();
  const outsideDir = mkdtempSync(path.join(os.tmpdir(), "dirong-retention-outside-"));
  try {
    const outsideAudioPath = path.join(outsideDir, "outside.ogg");
    writeFileSync(outsideAudioPath, "outside");
    const paths = seedSessionArtifacts(fixture, {
      sessionId: fixture.sessionId,
      writeAudioFiles: true,
      rawAudioPath: outsideAudioPath,
    });
    const plan = buildRetentionDeletionPlan({
      database: fixture.database,
      storageRoot: fixture.dir,
      sessionId: fixture.sessionId,
      policy: defaultPolicy,
      reason: "notion-upload-success",
      nowIso,
    });

    assert.throws(
      () => executeRetentionDeletionPlan(plan),
      /outside data root/,
    );
    assert.equal(existsSync(outsideAudioPath), true);
    assert.equal(existsSync(paths.sttAudioPath), true);
  } finally {
    fixture.close();
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test("expired text artifact plans delete old AI and draft files only", () => {
  const fixture = createFixture();
  try {
    const oldSessionId = "meeting_old_text";
    const recentSessionId = "meeting_recent_text";
    const oldPaths = seedSessionArtifacts(fixture, {
      sessionId: oldSessionId,
      writeAudioFiles: true,
      writeTextArtifacts: true,
      textCreatedAt: "2026-03-01T00:00:00.000Z",
    });
    const recentPaths = seedSessionArtifacts(fixture, {
      sessionId: recentSessionId,
      writeAudioFiles: true,
      writeTextArtifacts: true,
      textCreatedAt: "2026-05-01T00:00:00.000Z",
    });

    const plans = buildExpiredTextArtifactDeletionPlans({
      database: fixture.database,
      storageRoot: fixture.dir,
      policy: defaultPolicy,
      nowIso,
    });

    assert.deepEqual(
      plans.map((plan) => plan.sessionId),
      [oldSessionId],
    );
    assert.equal(plans[0]?.targets.length, 10);
    const result = executeRetentionDeletionPlan(plans[0]!);
    assert.equal(result.deleted, 10);
    assert.equal(existsSync(oldPaths.aiPromptPath), false);
    assert.equal(existsSync(oldPaths.draftMarkdownPath), false);
    assert.equal(existsSync(oldPaths.rawAudioPath), true);
    assert.equal(existsSync(recentPaths.aiPromptPath), true);
    assert.equal(existsSync(recentPaths.draftMarkdownPath), true);
  } finally {
    fixture.close();
  }
});

type RetentionFixture = {
  dir: string;
  database: DirongDatabase;
  sessionId: string;
  close: () => void;
};

type SeededPaths = {
  rawAudioPath: string;
  sttAudioPath: string;
  aiPromptPath: string;
  draftMarkdownPath: string;
};

function createFixture(): RetentionFixture {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-file-retention-"));
  const database = new DirongDatabase(path.join(dir, "dirong.sqlite"), 1000);
  return {
    dir,
    database,
    sessionId: "meeting_retention_test",
    close: () => {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function seedSessionArtifacts(
  fixture: RetentionFixture,
  options: {
    sessionId: string;
    writeAudioFiles: boolean;
    writeTextArtifacts?: boolean;
    textCreatedAt?: string;
    rawAudioPath?: string;
  },
): SeededPaths {
  const sessionDir = path.join(fixture.dir, options.sessionId);
  const rawAudioPath =
    options.rawAudioPath ?? path.join(sessionDir, "chunks", "chunk.ogg");
  const sttAudioPath = path.join(sessionDir, "stt-audio", "chunk.webm");
  const aiDir = path.join(sessionDir, "ai-cleanup");
  const aiPromptPath = path.join(aiDir, "prompt.txt");
  const draftMarkdownPath = path.join(aiDir, "draft.md");
  const draftRawOutputPath = path.join(aiDir, "draft-raw.txt");
  const chunkId = `${options.sessionId}_000001_speaker`;
  const aiJobId = `${options.sessionId}_ai_job`;
  const draftId = `${options.sessionId}_draft`;
  const textCreatedAt = options.textCreatedAt ?? nowIso;

  mkdirSync(path.dirname(rawAudioPath), { recursive: true });
  mkdirSync(path.dirname(sttAudioPath), { recursive: true });
  mkdirSync(aiDir, { recursive: true });
  if (options.writeAudioFiles) {
    writeFileSync(rawAudioPath, "raw");
    writeFileSync(sttAudioPath, "stt");
  }
  if (options.writeTextArtifacts) {
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
  }

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
      textCreatedAt,
      textCreatedAt,
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
      textCreatedAt,
      textCreatedAt,
    );

  return {
    rawAudioPath,
    sttAudioPath,
    aiPromptPath,
    draftMarkdownPath,
  };
}
