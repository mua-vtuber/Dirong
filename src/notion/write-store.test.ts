import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ProjectStore } from "../projects/project-store.js";
import { SqlRunner } from "../storage/sql-runner.js";
import { DirongDatabase } from "../storage/sqlite.js";
import { NotionWriteStore } from "./write-store.js";

const nowIso = "2026-05-07T00:00:00.000Z";

test("NotionWriteStore createOrGetWrite preserves draft target uniqueness", () => {
  const fixture = createFixture();
  try {
    const first = fixture.store.createOrGetWrite({
      sessionId: fixture.sessionId,
      draftId: fixture.draftId,
      targetType: "data_source",
      targetId: "target-1",
      targetUrl: "https://notion.so/db?v=view",
      contentHash: "hash-1",
      maxAttempts: 3,
      nowIso,
    });
    const second = fixture.store.createOrGetWrite({
      id: "ignored-id",
      sessionId: fixture.sessionId,
      draftId: fixture.draftId,
      targetType: "data_source",
      targetId: "target-1",
      targetUrl: "https://notion.so/db?v=view",
      contentHash: "hash-2",
      maxAttempts: 5,
      nowIso,
    });

    assert.equal(second.id, first.id);
    assert.equal(second.content_hash, "hash-1");
    assert.equal(second.max_attempts, 3);
  } finally {
    fixture.close();
  }
});

test("NotionWriteStore claims due writes and blocks duplicate claims", () => {
  const fixture = createFixture();
  try {
    const write = fixture.store.createOrGetWrite({
      id: "write-claim",
      sessionId: fixture.sessionId,
      draftId: fixture.draftId,
      targetType: "data_source",
      targetId: "target-1",
      targetUrl: "https://notion.so/db",
      contentHash: "hash",
      maxAttempts: 3,
      nowIso,
    });

    const claimed = fixture.store.claimWrite(write.id, "worker-1", 60000);
    const duplicate = fixture.store.claimWrite(write.id, "worker-2", 60000);

    assert.equal(claimed?.status, "processing");
    assert.equal(claimed?.attempts, 1);
    assert.equal(claimed?.locked_by, "worker-1");
    assert.equal(duplicate, null);
  } finally {
    fixture.close();
  }
});

test("NotionWriteStore lists only due queued and retry_wait writes", () => {
  const fixture = createFixture();
  try {
    fixture.store.createOrGetWrite({
      id: "write-due",
      sessionId: fixture.sessionId,
      draftId: fixture.draftId,
      targetType: "data_source",
      targetId: "target-due",
      targetUrl: "https://notion.so/db",
      contentHash: "hash",
      maxAttempts: 3,
      nowIso,
    });
    const future = fixture.store.createOrGetWrite({
      id: "write-future",
      sessionId: fixture.sessionId,
      draftId: fixture.draftId2,
      targetType: "data_source",
      targetId: "target-future",
      targetUrl: "https://notion.so/db",
      contentHash: "hash",
      maxAttempts: 3,
      nowIso: "2026-05-08T00:00:00.000Z",
    });
    fixture.store.markRetryWait({
      id: future.id,
      nextAttemptAt: "2099-05-08T00:00:00.000Z",
      statusMessage: "wait",
      lastError: "rate limit",
      nowIso,
    });

    assert.deepEqual(
      fixture.store
        .listDueWrites("2026-05-07T12:00:00.000Z", 10)
        .map((row) => row.id),
      ["write-due"],
    );
  } finally {
    fixture.close();
  }
});

test("NotionWriteStore saves page and appended block progress transactionally", () => {
  const fixture = createFixture();
  try {
    const write = fixture.store.createOrGetWrite({
      id: "write-progress",
      sessionId: fixture.sessionId,
      draftId: fixture.draftId,
      targetType: "data_source",
      targetId: "target-1",
      targetUrl: "https://notion.so/db",
      contentHash: "hash",
      maxAttempts: 3,
      nowIso,
    });

    fixture.store.savePageCreated({
      id: write.id,
      pageId: "page-1",
      pageUrl: "https://notion.so/page-1",
      nowIso,
    });
    fixture.store.saveBlockAppended({
      writeId: write.id,
      blockIndex: 0,
      contentHash: "block-hash-0",
      blockId: "block-0",
      nowIso,
    });
    fixture.store.saveRecoveredBlocks({
      writeId: write.id,
      blocks: [
        { blockIndex: 1, contentHash: "block-hash-1", blockId: "block-1" },
        { blockIndex: 2, contentHash: "block-hash-2", blockId: null },
      ],
      nowIso,
    });

    const updated = fixture.store.getWrite(write.id);
    assert.equal(updated?.notion_page_id, "page-1");
    assert.equal(updated?.last_successful_block_index, 2);
    assert.deepEqual(
      fixture.store.listBlocks(write.id).map((block) => ({
        index: block.block_index,
        status: block.status,
      })),
      [
        { index: 0, status: "appended" },
        { index: 1, status: "appended" },
        { index: 2, status: "appended" },
      ],
    );
  } finally {
    fixture.close();
  }
});

test("NotionWriteStore repairs expired leases into retry or failed states", () => {
  const fixture = createFixture();
  try {
    const retry = fixture.store.createOrGetWrite({
      id: "write-retry",
      sessionId: fixture.sessionId,
      draftId: fixture.draftId,
      targetType: "data_source",
      targetId: "target-retry",
      targetUrl: "https://notion.so/db",
      contentHash: "hash",
      maxAttempts: 2,
      nowIso,
    });
    const exhausted = fixture.store.createOrGetWrite({
      id: "write-exhausted",
      sessionId: fixture.sessionId,
      draftId: fixture.draftId2,
      targetType: "data_source",
      targetId: "target-exhausted",
      targetUrl: "https://notion.so/db",
      contentHash: "hash",
      maxAttempts: 1,
      nowIso,
    });

    assert.ok(fixture.store.claimWrite(retry.id, "worker", 1));
    assert.ok(fixture.store.claimWrite(exhausted.id, "worker", 1));
    fixture.database.db
      .prepare(
        `UPDATE notion_writes
         SET locked_until = '2000-01-01T00:00:00.000Z'
         WHERE id IN (?, ?)`,
      )
      .run(retry.id, exhausted.id);

    const released = fixture.store.releaseExpiredLeases(nowIso);

    assert.equal(released, 2);
    assert.equal(fixture.store.getWrite(retry.id)?.status, "retry_wait");
    assert.equal(fixture.store.getWrite(exhausted.id)?.status, "failed");
  } finally {
    fixture.close();
  }
});

test("NotionWriteStore force claims blocked and future retry writes", () => {
  const fixture = createFixture();
  try {
    const blocked = fixture.store.createOrGetWrite({
      id: "write-blocked-force",
      sessionId: fixture.sessionId,
      draftId: fixture.draftId,
      targetType: "data_source",
      targetId: "target-blocked",
      targetUrl: "https://notion.so/db",
      contentHash: "hash",
      maxAttempts: 3,
      nowIso,
    });
    const future = fixture.store.createOrGetWrite({
      id: "write-future-force",
      sessionId: fixture.sessionId,
      draftId: fixture.draftId2,
      targetType: "data_source",
      targetId: "target-future",
      targetUrl: "https://notion.so/db",
      contentHash: "hash",
      maxAttempts: 3,
      nowIso,
    });
    fixture.store.markBlocked({
      id: blocked.id,
      statusMessage: "blocked",
      lastError: "schema mismatch",
      nowIso,
    });
    fixture.store.markRetryWait({
      id: future.id,
      nextAttemptAt: "2099-05-08T00:00:00.000Z",
      statusMessage: "wait",
      lastError: "rate limit",
      nowIso,
    });

    assert.equal(fixture.store.claimWrite(blocked.id, "worker", 60000), null);
    assert.equal(fixture.store.claimWrite(future.id, "worker", 60000), null);
    assert.equal(
      fixture.store.claimWrite(blocked.id, "worker", 60000, { force: true })
        ?.status,
      "processing",
    );
    assert.equal(
      fixture.store.claimWrite(future.id, "worker", 60000, { force: true })
        ?.status,
      "processing",
    );
  } finally {
    fixture.close();
  }
});

test("NotionWriteStore blocks non-terminal writes for reset by project", () => {
  const fixture = createFixture();
  try {
    const queued = fixture.store.createOrGetWrite({
      id: "write-reset-queued",
      projectId: "default",
      sessionId: fixture.sessionId,
      draftId: fixture.draftId,
      targetType: "data_source",
      targetId: "target-reset",
      targetUrl: "https://notion.so/db",
      contentHash: "hash",
      maxAttempts: 3,
      nowIso,
    });
    const done = fixture.store.createOrGetWrite({
      id: "write-reset-done",
      projectId: "default",
      sessionId: fixture.sessionId,
      draftId: fixture.draftId2,
      targetType: "data_source",
      targetId: "target-reset-done",
      targetUrl: "https://notion.so/db",
      contentHash: "hash",
      maxAttempts: 3,
      nowIso,
    });
    fixture.store.markDone({
      id: done.id,
      statusMessage: "done",
      nowIso,
    });
    const other = fixture.store.createOrGetWrite({
      id: "write-reset-other",
      projectId: "project-other",
      sessionId: fixture.sessionId,
      draftId: "draft-other-project",
      targetType: "data_source",
      targetId: "target-other",
      targetUrl: "https://notion.so/db",
      contentHash: "hash",
      maxAttempts: 3,
      nowIso,
    });

    const changed = fixture.store.blockNonTerminalWritesForReset({
      projectId: "default",
      nowIso: "2026-05-07T00:01:00.000Z",
      message: "Blocked by reset",
    });

    assert.equal(changed, 1);
    assert.equal(fixture.store.getWrite(queued.id)?.status, "blocked");
    assert.equal(fixture.store.getWrite(done.id)?.status, "done");
    assert.equal(fixture.store.getWrite(other.id)?.status, "queued");
  } finally {
    fixture.close();
  }
});

type StoreFixture = {
  dir: string;
  database: DirongDatabase;
  store: NotionWriteStore;
  sessionId: string;
  draftId: string;
  draftId2: string;
  close: () => void;
};

function createFixture(): StoreFixture {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-notion-store-"));
  const database = new DirongDatabase(path.join(dir, "dirong.sqlite"), 1000);
  const runner = new SqlRunner(database);
  const store = new NotionWriteStore(runner);
  new ProjectStore(runner).createDraftProject({
    id: "project-other",
    nowIso,
  });
  const sessionId = "session-notion";
  const draftId = "draft-notion";
  const draftId2 = "draft-notion-2";
  insertSession(database, sessionId);
  insertAiCleanupJob(database, sessionId, "ai-job-1");
  insertAiCleanupJob(database, sessionId, "ai-job-2");
  insertDraft(database, sessionId, "ai-job-1", draftId);
  insertDraft(database, sessionId, "ai-job-2", draftId2);
  insertAiCleanupJob(database, sessionId, "ai-job-other-project");
  insertDraft(database, sessionId, "ai-job-other-project", "draft-other-project");

  return {
    dir,
    database,
    store,
    sessionId,
    draftId,
    draftId2,
    close: () => {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function insertSession(database: DirongDatabase, sessionId: string): void {
  database.db
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
      sessionId,
      nowIso,
      nowIso,
      nowIso,
      path.dirname(database.dbPath),
      nowIso,
      nowIso,
    );
}

function insertAiCleanupJob(
  database: DirongDatabase,
  sessionId: string,
  jobId: string,
): void {
  database.db
    .prepare(
      `INSERT INTO ai_cleanup_jobs (
         id, session_id, status, attempts, max_attempts, locked_by,
         locked_until, next_attempt_at, provider, model, command,
         prompt_version, input_contract_version, input_hash, input_entry_count,
         input_timeline_json_path, input_timeline_markdown_path, prompt_path,
         raw_output_path, stderr_path, parsed_json_path, markdown_path,
         output_hash, failure_kind, last_error, created_at, updated_at
       ) VALUES (
         ?, ?, 'done', 1, 3, NULL, NULL, ?, 'fake', 'model', NULL,
         'prompt-v1', 'timeline-v1', ?, 1, NULL, NULL, NULL,
         NULL, NULL, NULL, NULL, 'output-hash', NULL, NULL, ?, ?
       )`,
    )
    .run(jobId, sessionId, nowIso, `input-hash-${jobId}`, nowIso, nowIso);
}

function insertDraft(
  database: DirongDatabase,
  sessionId: string,
  jobId: string,
  draftId: string,
): void {
  database.db
    .prepare(
      `INSERT INTO meeting_notes_drafts (
         id, session_id, ai_cleanup_job_id, schema_version, language, title,
         summary_text, draft_json, markdown, json_path, markdown_path,
         raw_output_path, provider, model, prompt_version, input_hash,
         output_hash, validation_status, created_at, updated_at
       ) VALUES (
         ?, ?, ?, 'v1', 'ko', '회의록', '요약', '{}', '# 회의록',
         'draft.json', 'draft.md', 'raw.txt', 'fake', 'model', 'prompt-v1',
         'input-hash', ?, 'valid', ?, ?
       )`,
    )
    .run(draftId, sessionId, jobId, `output-hash-${draftId}`, nowIso, nowIso);
}
