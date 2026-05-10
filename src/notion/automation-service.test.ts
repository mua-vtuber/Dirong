import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { NotionClient } from "./client.js";
import { NotionAutomationService } from "./automation-service.js";
import { NotionDraftInputReadModel } from "./draft-input-read-model.js";
import { NOTION_MANAGED_SCHEMA_VERSION } from "./managed-schema.js";
import { NotionRegistryStore } from "./registry-store.js";
import {
  DEFAULT_NOTION_PROPERTY_NAMES,
  type NotionRuntimeSettings,
} from "./settings.js";
import { makeNotionDraftInput } from "./test-fixtures.js";
import { NotionWriteStore } from "./write-store.js";
import { SqlRunner } from "../storage/sql-runner.js";
import { DirongDatabase } from "../storage/sqlite.js";

const nowIso = "2026-05-07T00:00:00.000Z";
const targetId = "01234567-89ab-cdef-0123-456789abcdef";

test("NotionAutomationService does nothing when export is disabled", async () => {
  const fixture = createFixture();
  try {
    const client = new FakeNotionClient();
    const service = createService(fixture, {
      settings: notionSettings({ enabled: false }),
      client,
    });

    const snapshot = await service.runOnce();

    assert.equal(snapshot.status, "disabled");
    assert.equal(countNotionWrites(fixture.database), 0);
    assert.deepEqual(client.calls, []);
  } finally {
    fixture.close();
  }
});

test("NotionAutomationService does nothing in manual upload mode", async () => {
  const fixture = createFixture();
  try {
    const client = new FakeNotionClient();
    const service = createService(fixture, {
      settings: notionSettings({ uploadMode: "manual" }),
      client,
    });

    const snapshot = await service.runOnce();

    assert.equal(snapshot.status, "manual");
    assert.equal(countNotionWrites(fixture.database), 0);
    assert.deepEqual(client.calls, []);
  } finally {
    fixture.close();
  }
});

test("NotionAutomationService does nothing when Notion settings are incomplete", async () => {
  const fixture = createFixture();
  try {
    const service = createService(fixture, {
      settings: notionSettings({ apiKey: null, targetUrl: null }),
      client: null,
    });

    const snapshot = await service.runOnce();

    assert.equal(snapshot.status, "not_configured");
    assert.equal(countNotionWrites(fixture.database), 0);
  } finally {
    fixture.close();
  }
});

test("NotionAutomationService uploads one completed valid draft once", async () => {
  const fixture = createFixture();
  try {
    const client = new FakeNotionClient();
    const service = createService(fixture, { client });

    const first = await service.runOnce();
    const second = await service.runOnce();

    assert.equal(first.status, "done");
    assert.equal(first.draftId, fixture.draftId);
    assert.equal(first.pageUrl, "https://notion.so/page-1");
    assert.equal(second.status, "idle");
    assert.equal(countNotionWrites(fixture.database), 1);
    assert.equal(
      client.calls.filter((call) => call.method === "createPage").length,
      1,
    );
  } finally {
    fixture.close();
  }
});

test("NotionAutomationService blocks partial managed registry before legacy fallback", async () => {
  const fixture = createFixture();
  try {
    const registryStore = new NotionRegistryStore(fixture.runner);
    registryStore.upsertManagedDatabase({
      role: "meeting",
      locale: "ko",
      databaseId: "managed-meeting-db",
      dataSourceId: targetId,
      url: "https://notion.so/managed-meeting",
      name: "회의록",
      createdByDirong: true,
      schemaVersion: NOTION_MANAGED_SCHEMA_VERSION,
      nowIso,
    });
    const client = new FakeNotionClient();
    const service = createService(fixture, { client, registryStore });

    const snapshot = await service.runOnce();

    assert.equal(snapshot.status, "blocked");
    assert.match(snapshot.userAction ?? "", /legacy target/);
    assert.equal(countNotionWrites(fixture.database), 0);
    assert.deepEqual(client.calls, []);
  } finally {
    fixture.close();
  }
});

test("NotionAutomationService ignores drafts that are not valid", async () => {
  const fixture = createFixture({ validationStatus: "invalid" });
  try {
    const client = new FakeNotionClient();
    const service = createService(fixture, { client });

    const snapshot = await service.runOnce();

    assert.equal(snapshot.status, "idle");
    assert.equal(countNotionWrites(fixture.database), 0);
    assert.deepEqual(client.calls, []);
  } finally {
    fixture.close();
  }
});

test("NotionAutomationService repairs expired write leases before selecting work", async () => {
  const fixture = createFixture();
  try {
    const write = fixture.writeStore.createOrGetWrite({
      id: "notion-expired",
      sessionId: fixture.sessionId,
      draftId: fixture.draftId,
      targetType: "data_source",
      targetId,
      targetUrl: targetId,
      contentHash: "hash",
      maxAttempts: 1,
      nowIso,
    });
    assert.ok(fixture.writeStore.claimWrite(write.id, "stale-worker", 1));
    fixture.database.db
      .prepare(
        `UPDATE notion_writes
         SET locked_until = '2000-01-01T00:00:00.000Z'
         WHERE id = ?`,
      )
      .run(write.id);
    const service = createService(fixture, { client: new FakeNotionClient() });

    const snapshot = await service.runOnce();

    assert.equal(snapshot.repairedExpiredLeases, 1);
    assert.equal(fixture.writeStore.getWrite(write.id)?.status, "failed");
    assert.equal(snapshot.status, "not_claimed");
  } finally {
    fixture.close();
  }
});

class FakeNotionClient implements NotionClient {
  readonly calls: Array<{ method: string; body?: unknown }> = [];

  async retrievePage(): Promise<Record<string, unknown>> {
    this.calls.push({ method: "retrievePage" });
    return { id: "page-1", object: "page" };
  }

  async retrieveDatabase(): Promise<Record<string, unknown>> {
    this.calls.push({ method: "retrieveDatabase" });
    return { data_sources: [{ id: targetId }] };
  }

  async createDatabase(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.calls.push({ method: "createDatabase", body });
    return { id: "database-1", data_sources: [{ id: targetId }] };
  }

  async createDataSource(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.calls.push({ method: "createDataSource", body });
    return { id: "data-source-1", properties: {} };
  }

  async retrieveDataSource(): Promise<Record<string, unknown>> {
    this.calls.push({ method: "retrieveDataSource" });
    return {
      id: targetId,
      name: "회의록",
      properties: completeProperties(),
    };
  }

  async updateDataSource(
    _dataSourceId: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    this.calls.push({ method: "updateDataSource", body });
    return {
      id: targetId,
      name: "회의록",
      properties: completeProperties(),
    };
  }

  async queryDataSource(
    _dataSourceId: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    this.calls.push({ method: "queryDataSource", body });
    return { results: [] };
  }

  async createPage(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.calls.push({ method: "createPage", body });
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

type AutomationFixture = {
  dir: string;
  database: DirongDatabase;
  runner: SqlRunner;
  writeStore: NotionWriteStore;
  sessionId: string;
  draftId: string;
  close: () => void;
};

function createFixture(options: {
  validationStatus?: "valid" | "invalid";
} = {}): AutomationFixture {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-notion-auto-"));
  const database = new DirongDatabase(path.join(dir, "dirong.sqlite"), 1000);
  const runner = new SqlRunner(database);
  const writeStore = new NotionWriteStore(runner);
  const draftInput = makeNotionDraftInput();
  insertSession(database, dir, draftInput);
  insertSpeaker(database, draftInput);
  insertAiCleanupJob(database, draftInput);
  insertDraft(database, draftInput, options.validationStatus ?? "valid");

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

function createService(
  fixture: AutomationFixture,
  options: {
    settings?: NotionRuntimeSettings;
    client?: NotionClient | null;
    registryStore?: NotionRegistryStore | null;
  } = {},
): NotionAutomationService {
  return new NotionAutomationService({
    settings: options.settings ?? notionSettings(),
    client: options.client === undefined ? new FakeNotionClient() : options.client,
    readModel: new NotionDraftInputReadModel(fixture.runner),
    writeStore: fixture.writeStore,
    pollIntervalMs: 5000,
    batchLimit: 1,
    workerId: "notion-auto-test",
    leaseMs: 60000,
    registryStore: options.registryStore,
  });
}

function notionSettings(
  overrides: Partial<NotionRuntimeSettings> = {},
): NotionRuntimeSettings {
  return {
    enabled: true,
    apiKey: "ntn_test_secret",
    apiVersion: "2026-03-11",
    baseUrl: "https://api.notion.com",
    targetUrl: targetId,
    targetType: "data_source",
    uploadMode: "automatic_after_ai_cleanup",
    templateType: "app",
    includeTranscript: "never",
    autoPollMs: 5000,
    leaseMs: 60000,
    maxAttempts: 3,
    propertyNames: DEFAULT_NOTION_PROPERTY_NAMES,
    ...overrides,
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
  validationStatus: "valid" | "invalid",
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
         ?, ?, ?, ?
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
      validationStatus,
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
