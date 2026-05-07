import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NotionApiError, type NotionClient } from "./client.js";
import { NotionDraftInputReadModel } from "./draft-input-read-model.js";
import { DEFAULT_NOTION_PROPERTY_NAMES, type NotionRuntimeSettings } from "./settings.js";
import { makeNotionDraftInput } from "./test-fixtures.js";
import { runNotionUpload } from "./writer.js";
import { NotionWriteStore } from "./write-store.js";
import { SqlRunner } from "../storage/sql-runner.js";
import { DirongDatabase } from "../storage/sqlite.js";

const nowIso = "2026-05-07T00:00:00.000Z";
const targetId = "01234567-89ab-cdef-0123-456789abcdef";

test("runNotionUpload dry-run validates schema and renders without DB or page writes", async () => {
  const fixture = createFixture();
  try {
    const client = new FakeNotionClient();
    const result = await runNotionUpload({
      settings: notionSettings(),
      selector: { kind: "draft", draftId: fixture.draftId },
      dryRun: true,
      force: false,
      workerId: "writer-test",
      leaseMs: 60000,
      nowIso,
      client,
      readModel: new NotionDraftInputReadModel(fixture.runner),
      writeStore: null,
    });

    assert.equal(result.status, "dry_run");
    assert.equal(result.dbChanged, false);
    assert.equal(result.blockCount > 0, true);
    assert.deepEqual(client.calls.map((call) => call.method), [
      "retrieveDataSource",
    ]);
    assert.equal(countNotionWrites(fixture.database), 0);
  } finally {
    fixture.close();
  }
});

test("runNotionUpload creates a page, appends blocks, and marks done", async () => {
  const fixture = createFixture();
  try {
    const client = new FakeNotionClient();
    const result = await runNotionUpload({
      settings: notionSettings(),
      selector: { kind: "session", sessionId: fixture.sessionId },
      dryRun: false,
      force: false,
      workerId: "writer-test",
      leaseMs: 60000,
      nowIso,
      client,
      readModel: new NotionDraftInputReadModel(fixture.runner),
      writeStore: fixture.writeStore,
    });

    assert.equal(result.status, "done");
    assert.equal(result.pageUrl, "https://notion.so/page-1");
    assert.deepEqual(client.calls.map((call) => call.method), [
      "retrieveDataSource",
      "queryDataSource",
      "createPage",
      "retrieveBlockChildren",
      "appendBlockChildren",
      "updatePage",
    ]);
    assert.equal(client.createPageBodies[0]?.children, undefined);
    assert.equal(fixture.writeStore.getWrite(result.writeId ?? "")?.status, "done");
    assert.equal(fixture.writeStore.listBlocks(result.writeId ?? "").length, result.blockCount);
  } finally {
    fixture.close();
  }
});

test("runNotionUpload reuses a remote page found by Draft ID", async () => {
  const fixture = createFixture();
  try {
    const client = new FakeNotionClient({
      queryResults: [{ id: "existing-page", url: "https://notion.so/existing" }],
    });
    const result = await runNotionUpload({
      settings: notionSettings(),
      selector: { kind: "draft", draftId: fixture.draftId },
      dryRun: false,
      force: false,
      workerId: "writer-test",
      leaseMs: 60000,
      nowIso,
      client,
      readModel: new NotionDraftInputReadModel(fixture.runner),
      writeStore: fixture.writeStore,
    });

    assert.equal(result.status, "done");
    assert.equal(result.pageUrl, "https://notion.so/existing");
    assert.equal(
      client.calls.some((call) => call.method === "createPage"),
      false,
    );
  } finally {
    fixture.close();
  }
});

test("runNotionUpload blocks when remote Draft ID lookup returns duplicates", async () => {
  const fixture = createFixture();
  try {
    const client = new FakeNotionClient({
      queryResults: [
        { id: "existing-page-1", url: "https://notion.so/existing-1" },
        { id: "existing-page-2", url: "https://notion.so/existing-2" },
      ],
    });
    const result = await runNotionUpload({
      settings: notionSettings(),
      selector: { kind: "draft", draftId: fixture.draftId },
      dryRun: false,
      force: false,
      workerId: "writer-test",
      leaseMs: 60000,
      nowIso,
      client,
      readModel: new NotionDraftInputReadModel(fixture.runner),
      writeStore: fixture.writeStore,
    });

    assert.equal(result.status, "blocked");
    assert.match(result.userAction ?? "", /Draft ID/);
    assert.equal(
      client.calls.some((call) => call.method === "createPage"),
      false,
    );
  } finally {
    fixture.close();
  }
});

test("runNotionUpload schedules retry_wait on Notion rate limits", async () => {
  const fixture = createFixture();
  try {
    const client = new FakeNotionClient({
      appendError: new NotionApiError(
        "rate_limited",
        "Notion API 사용량 제한으로 잠시 대기합니다.",
        {
          status: 429,
          code: "rate_limited",
          retryAfterSeconds: 30,
          retriable: true,
          userAction: "잠시 후 자동 재시도됩니다.",
          technicalDetail: "rate limited",
        },
      ),
    });
    const result = await runNotionUpload({
      settings: notionSettings(),
      selector: { kind: "draft", draftId: fixture.draftId },
      dryRun: false,
      force: false,
      workerId: "writer-test",
      leaseMs: 60000,
      nowIso,
      client,
      readModel: new NotionDraftInputReadModel(fixture.runner),
      writeStore: fixture.writeStore,
    });

    assert.equal(result.status, "retry_wait");
    const write = fixture.writeStore.getWrite(result.writeId ?? "");
    assert.equal(write?.status, "retry_wait");
    assert.equal(write?.next_attempt_at, "2026-05-07T00:00:30.000Z");
  } finally {
    fixture.close();
  }
});

test("runNotionUpload blocks on schema mismatch before local write creation", async () => {
  const fixture = createFixture();
  try {
    const client = new FakeNotionClient({
      properties: {
        ...completeProperties(),
        "Draft ID": { id: "draft-id", type: "number" },
      },
    });
    const result = await runNotionUpload({
      settings: notionSettings(),
      selector: { kind: "draft", draftId: fixture.draftId },
      dryRun: false,
      force: false,
      workerId: "writer-test",
      leaseMs: 60000,
      nowIso,
      client,
      readModel: new NotionDraftInputReadModel(fixture.runner),
      writeStore: fixture.writeStore,
    });

    assert.equal(result.status, "blocked");
    assert.match(result.userAction ?? "", /속성 타입/);
    assert.equal(countNotionWrites(fixture.database), 0);
  } finally {
    fixture.close();
  }
});

class FakeNotionClient implements NotionClient {
  readonly calls: Array<{ method: string; body?: unknown }> = [];
  readonly createPageBodies: Array<Record<string, unknown>> = [];

  constructor(
    private readonly options: {
      queryResults?: unknown[];
      appendError?: NotionApiError;
      properties?: Record<string, { id: string; type: string }>;
    } = {},
  ) {}

  async retrieveDatabase(): Promise<Record<string, unknown>> {
    this.calls.push({ method: "retrieveDatabase" });
    return { data_sources: [{ id: targetId }] };
  }

  async retrieveDataSource(): Promise<Record<string, unknown>> {
    this.calls.push({ method: "retrieveDataSource" });
    return {
      id: targetId,
      name: "회의록",
      properties: this.options.properties ?? completeProperties(),
    };
  }

  async queryDataSource(
    _dataSourceId: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    this.calls.push({ method: "queryDataSource", body });
    return { results: this.options.queryResults ?? [] };
  }

  async createPage(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.calls.push({ method: "createPage", body });
    this.createPageBodies.push(body);
    return { id: "page-1", url: "https://notion.so/page-1" };
  }

  async updatePage(
    _pageId: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    this.calls.push({ method: "updatePage", body });
    return { id: "page-1", url: "https://notion.so/page-1" };
  }

  async appendBlockChildren(
    _blockId: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    this.calls.push({ method: "appendBlockChildren", body });
    if (this.options.appendError) {
      throw this.options.appendError;
    }
    const children = Array.isArray(body.children) ? body.children : [];
    return {
      results: children.map((_, index) => ({ id: `block-${index}` })),
    };
  }

  async retrieveBlockChildren(): Promise<Record<string, unknown>> {
    this.calls.push({ method: "retrieveBlockChildren" });
    return { results: [] };
  }
}

type WriterFixture = {
  dir: string;
  database: DirongDatabase;
  runner: SqlRunner;
  writeStore: NotionWriteStore;
  sessionId: string;
  draftId: string;
  close: () => void;
};

function createFixture(): WriterFixture {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-notion-writer-"));
  const database = new DirongDatabase(path.join(dir, "dirong.sqlite"), 1000);
  const runner = new SqlRunner(database);
  const writeStore = new NotionWriteStore(runner);
  const draftInput = makeNotionDraftInput();
  insertSession(database, dir, draftInput);
  insertSpeaker(database, draftInput);
  insertAiCleanupJob(database, draftInput);
  insertDraft(database, draftInput);

  return {
    dir,
    database,
    runner,
    writeStore,
    sessionId: draftInput.session.id,
    draftId: draftInput.draft.id,
    close: () => {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function notionSettings(): NotionRuntimeSettings {
  return {
    enabled: true,
    apiKey: "ntn_test_secret",
    apiVersion: "2026-03-11",
    baseUrl: "https://api.notion.com",
    targetUrl: targetId,
    targetType: "data_source",
    uploadMode: "manual",
    templateType: "app",
    includeTranscript: "never",
    autoPollMs: 5000,
    leaseMs: 60000,
    maxAttempts: 3,
    propertyNames: DEFAULT_NOTION_PROPERTY_NAMES,
  };
}

function completeProperties(): Record<string, { id: string; type: string }> {
  return {
    Name: { id: "title-id", type: "title" },
    Date: { id: "date-id", type: "date" },
    "Meeting Time": { id: "meeting-time-id", type: "rich_text" },
    Channel: { id: "channel-id", type: "rich_text" },
    Participants: { id: "participants-id", type: "multi_select" },
    Status: { id: "status-id", type: "select" },
    "Session ID": { id: "session-id", type: "rich_text" },
    "Draft ID": { id: "draft-id", type: "rich_text" },
    "Dirong Content Hash": { id: "content-hash-id", type: "rich_text" },
    "Local Status": { id: "local-status-id", type: "rich_text" },
  };
}

function insertSession(
  database: DirongDatabase,
  dir: string,
  input: ReturnType<typeof makeNotionDraftInput>,
): void {
  database.db
    .prepare(
      `INSERT INTO sessions (
         id, guild_id, guild_name, text_channel_id, voice_channel_id,
         voice_channel_name, started_by_user_id, started_by_display_name,
         stopped_by_user_id, stopped_by_display_name, status, started_at,
         stopped_at, finalized_at, data_dir, last_error, created_at, updated_at
       ) VALUES (
         ?, 'guild', 'Guild', 'text', ?, ?, 'starter', 'Taniar',
         NULL, NULL, 'finalized', ?, ?, ?, ?, NULL, ?, ?
       )`,
    )
    .run(
      input.session.id,
      input.session.voice_channel_id,
      input.session.voice_channel_name,
      input.session.started_at,
      input.session.finalized_at,
      input.session.finalized_at,
      dir,
      nowIso,
      nowIso,
    );
}

function insertSpeaker(
  database: DirongDatabase,
  input: ReturnType<typeof makeNotionDraftInput>,
): void {
  for (const speaker of input.speakers) {
    database.db
      .prepare(
        `INSERT INTO session_speakers (
           session_id, user_id, display_name_snapshot, is_bot,
           first_seen_at_ms, first_seen_at, last_seen_at_ms, last_seen_at,
           chunk_count
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.session.id,
        speaker.user_id,
        speaker.display_name_snapshot,
        speaker.is_bot,
        speaker.first_seen_at_ms,
        nowIso,
        speaker.last_seen_at_ms,
        nowIso,
        speaker.chunk_count,
      );
  }
}

function insertAiCleanupJob(
  database: DirongDatabase,
  input: ReturnType<typeof makeNotionDraftInput>,
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
         ?, ?, 'done', 1, 3, NULL, NULL, ?, ?, ?, NULL,
         ?, 'timeline-v1', 'input-hash', 1, NULL, NULL, NULL,
         NULL, NULL, NULL, NULL, ?, NULL, NULL, ?, ?
       )`,
    )
    .run(
      "ai-job-1",
      input.session.id,
      nowIso,
      input.draft.provider,
      input.draft.model,
      input.draft.prompt_version,
      input.draft.output_hash,
      nowIso,
      nowIso,
    );
}

function insertDraft(
  database: DirongDatabase,
  input: ReturnType<typeof makeNotionDraftInput>,
): void {
  database.db
    .prepare(
      `INSERT INTO meeting_notes_drafts (
         id, session_id, ai_cleanup_job_id, schema_version, language, title,
         summary_text, draft_json, markdown, json_path, markdown_path,
         raw_output_path, provider, model, prompt_version, input_hash,
         output_hash, validation_status, created_at, updated_at
       ) VALUES (
         ?, ?, ?, 'v1', 'ko', ?, ?, ?, '# 회의록',
         'draft.json', 'draft.md', 'raw.txt', ?, ?, ?, 'input-hash',
         ?, 'valid', ?, ?
       )`,
    )
    .run(
      input.draft.id,
      input.session.id,
      "ai-job-1",
      input.draftContent.meetingTitle.text,
      input.draftContent.summary.text,
      JSON.stringify(input.draftContent),
      input.draft.provider,
      input.draft.model,
      input.draft.prompt_version,
      input.draft.output_hash,
      nowIso,
      nowIso,
    );
}

function countNotionWrites(database: DirongDatabase): number {
  const row = database.db
    .prepare("SELECT COUNT(*) AS count FROM notion_writes")
    .get() as { count: number };
  return row.count;
}
