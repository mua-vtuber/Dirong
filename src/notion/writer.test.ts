import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NotionApiError, type NotionClient } from "./client.js";
import { NotionDraftInputReadModel } from "./draft-input-read-model.js";
import type { NotionDataSourceProperties } from "./schema.js";
import { DEFAULT_NOTION_PROPERTY_NAMES, type NotionRuntimeSettings } from "./settings.js";
import {
  KOREAN_NOTION_SCHEMA_PRESET,
  NOTION_MEETING_STATUS_OPTIONS,
} from "./schema-presets.js";
import { NotionRegistryStore } from "./registry-store.js";
import { makeNotionDraftInput } from "./test-fixtures.js";
import { runNotionUpload } from "./writer.js";
import { NotionWriteStore } from "./write-store.js";
import { SqlRunner } from "../storage/sql-runner.js";
import { DirongDatabase } from "../storage/sqlite.js";

const nowIso = "2026-05-07T00:00:00.000Z";
const targetId = "01234567-89ab-cdef-0123-456789abcdef";
const relationTargetId = "11111111-2222-3333-4444-555555555555";
const relationTargetPageId = "22222222-3333-4444-5555-666666666666";
const managedMeetingDataSourceId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const managedMemberDataSourceId = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff";
const managedTaskDataSourceId = "cccccccc-dddd-eeee-ffff-000000000000";

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

test("runNotionUpload renders status payloads for Notion status properties", async () => {
  const fixture = createFixture();
  try {
    const client = new FakeNotionClient({
      properties: {
        ...completeProperties(),
        Status: {
          id: "status-id",
          type: "status",
          status: {
            options: [
              { id: "draft-id", name: "draft" },
              { id: "done-id", name: "done" },
              { id: "retry-id", name: "retry_wait" },
              { id: "failed-id", name: "failed" },
            ],
          },
        },
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
    const properties = client.createPageBodies[0]?.properties as {
      Status?: unknown;
    };

    assert.equal(result.status, "done");
    assert.deepEqual(properties.Status, {
      status: { name: "draft" },
    });
  } finally {
    fixture.close();
  }
});

test("runNotionUpload does not write Participants when it is a rollup", async () => {
  const fixture = createFixture();
  try {
    const client = new FakeNotionClient({
      properties: {
        ...completeProperties(),
        Participants: { id: "participants-id", type: "rollup" },
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
    const createdProperties = client.createPageBodies[0]?.properties as Record<
      string,
      unknown
    >;
    const doneUpdate = client.calls
      .filter((call) => call.method === "updatePage")
      .at(-1)?.body as { properties?: Record<string, unknown> } | undefined;

    assert.equal(result.status, "done");
    assert.equal("Participants" in createdProperties, false);
    assert.equal("Participants" in (doneUpdate?.properties ?? {}), false);
  } finally {
    fixture.close();
  }
});

test("runNotionUpload uses managed meeting registry and writes matched member relation", async () => {
  const fixture = createFixture();
  seedManagedRegistry(fixture.registryStore);
  try {
    const client = new FakeNotionClient();
    const result = await runNotionUpload({
      settings: notionSettings({ targetUrl: targetId }),
      selector: { kind: "draft", draftId: fixture.draftId },
      dryRun: false,
      force: false,
      workerId: "writer-test",
      leaseMs: 60000,
      nowIso,
      client,
      readModel: new NotionDraftInputReadModel(fixture.runner),
      writeStore: fixture.writeStore,
      registryStore: fixture.registryStore,
    });
    const createdProperties = client.createPageBodies[0]?.properties as Record<
      string,
      unknown
    >;

    assert.equal(result.status, "done");
    assert.equal(result.targetId, managedMeetingDataSourceId);
    assert.deepEqual(client.createPageBodies[0]?.parent, {
      data_source_id: managedMeetingDataSourceId,
    });
    assert.equal("참가자" in createdProperties, false);
    assert.deepEqual(createdProperties["참가자 연결"], {
      relation: [{ id: "member-taniar" }, { id: "member-ari" }],
    });
    assert.deepEqual(createdProperties["회의록"], {
      title: [{ text: { content: "주간 회의" } }],
    });
  } finally {
    fixture.close();
  }
});

test("runNotionUpload blocks instead of falling back when managed registry is incomplete", async () => {
  const fixture = createFixture();
  fixture.registryStore.upsertManagedDatabase({
    role: "meeting",
    locale: "ko",
    databaseId: "managed-meeting-db",
    dataSourceId: managedMeetingDataSourceId,
    url: "https://notion.so/managed-meeting",
    name: "회의록",
    createdByDirong: true,
    schemaVersion: "notion-managed-db-v1",
    nowIso,
  });
  try {
    const client = new FakeNotionClient();
    const result = await runNotionUpload({
      settings: notionSettings({ targetUrl: targetId }),
      selector: { kind: "draft", draftId: fixture.draftId },
      dryRun: false,
      force: false,
      workerId: "writer-test",
      leaseMs: 60000,
      nowIso,
      client,
      readModel: new NotionDraftInputReadModel(fixture.runner),
      writeStore: fixture.writeStore,
      registryStore: fixture.registryStore,
    });

    assert.equal(result.status, "blocked");
    assert.match(result.userAction ?? "", /legacy target/);
    assert.equal(client.createPageBodies.length, 0);
  } finally {
    fixture.close();
  }
});

test("runNotionUpload keeps managed upload successful when a member is unmatched", async () => {
  const fixture = createFixture();
  seedManagedRegistry(fixture.registryStore);
  try {
    const client = new FakeNotionClient({
      memberQueryResultsByName: {
        Taniar: [{ id: "member-taniar" }],
        Ari: [],
      },
    });
    const result = await runNotionUpload({
      settings: notionSettings({ targetUrl: null }),
      selector: { kind: "draft", draftId: fixture.draftId },
      dryRun: false,
      force: false,
      workerId: "writer-test",
      leaseMs: 60000,
      nowIso,
      client,
      readModel: new NotionDraftInputReadModel(fixture.runner),
      writeStore: fixture.writeStore,
      registryStore: fixture.registryStore,
    });
    const createdProperties = client.createPageBodies[0]?.properties as Record<
      string,
      unknown
    >;

    assert.equal(result.status, "done");
    assert.deepEqual(createdProperties["참가자 연결"], {
      relation: [{ id: "member-taniar" }],
    });
    assert.match(result.warnings.join("\n"), /Ari/);
  } finally {
    fixture.close();
  }
});

test("runNotionUpload renders managed properties from semantic mappings", async () => {
  const fixture = createFixture();
  seedManagedRegistry(fixture.registryStore, {
    meetingPropertyNameOverrides: {
      "meeting.title": "미팅 제목",
      "meeting.status": "업로드 상태",
      "meeting.memberRelation": "멤버 링크",
      "meeting.participants": "참석자 롤업",
    },
  });
  try {
    const client = new FakeNotionClient({
      managedMeetingProperties: koreanManagedMeetingProperties({
        "회의록": "미팅 제목",
        "상태": "업로드 상태",
        "참가자 연결": "멤버 링크",
        "참가자": "참석자 롤업",
      }),
    });
    const result = await runNotionUpload({
      settings: notionSettings({ targetUrl: null }),
      selector: { kind: "draft", draftId: fixture.draftId },
      dryRun: false,
      force: false,
      workerId: "writer-test",
      leaseMs: 60000,
      nowIso,
      client,
      readModel: new NotionDraftInputReadModel(fixture.runner),
      writeStore: fixture.writeStore,
      registryStore: fixture.registryStore,
    });
    const createdProperties = client.createPageBodies[0]?.properties as Record<
      string,
      unknown
    >;

    assert.equal(result.status, "done");
    assert.deepEqual(createdProperties["미팅 제목"], {
      title: [{ text: { content: "주간 회의" } }],
    });
    assert.deepEqual(createdProperties["업로드 상태"], {
      select: { name: "draft" },
    });
    assert.deepEqual(createdProperties["멤버 링크"], {
      relation: [{ id: "member-taniar" }, { id: "member-ari" }],
    });
    assert.equal("참석자 롤업" in createdProperties, false);
  } finally {
    fixture.close();
  }
});

test("runNotionUpload creates managed task pages for action items", async () => {
  const fixture = createFixture({ actionItems: managedActionItems() });
  seedManagedRegistry(fixture.registryStore);
  try {
    const client = new FakeNotionClient();
    const result = await runNotionUpload({
      settings: notionSettings({ targetUrl: null }),
      selector: { kind: "draft", draftId: fixture.draftId },
      dryRun: false,
      force: false,
      workerId: "writer-test",
      leaseMs: 60000,
      nowIso,
      client,
      readModel: new NotionDraftInputReadModel(fixture.runner),
      writeStore: fixture.writeStore,
      registryStore: fixture.registryStore,
    });
    const meetingProperties = client.createPageBodies[0]?.properties as Record<
      string,
      unknown
    >;
    const firstTaskProperties = client.taskCreatePageBodies[0]?.properties as Record<
      string,
      unknown
    >;
    const secondTaskProperties = client.taskCreatePageBodies[1]?.properties as Record<
      string,
      unknown
    >;

    assert.equal(result.status, "done");
    assert.equal(client.taskCreatePageBodies.length, 2);
    assert.equal("액션 아이템" in meetingProperties, false);
    assert.deepEqual(firstTaskProperties["작업"], {
      title: [{ text: { content: "Notion writer 테스트를 추가한다." } }],
    });
    assert.deepEqual(firstTaskProperties["회의록"], {
      relation: [{ id: "page-1" }],
    });
    assert.deepEqual(firstTaskProperties["작업자 연결"], {
      relation: [{ id: "member-taniar" }],
    });
    assert.deepEqual(firstTaskProperties["Dirong 액션 ID"], {
      rich_text: [{ text: { content: "draft-1:action-1" } }],
    });
    assert.deepEqual(secondTaskProperties["작업자 연결"], {
      relation: [{ id: "member-ari" }],
    });
    assert.deepEqual(secondTaskProperties["마감일"], {
      date: { start: "2026-05-15" },
    });
  } finally {
    fixture.close();
  }
});

test("runNotionUpload updates existing managed task pages by source action id", async () => {
  const fixture = createFixture({ actionItems: managedActionItems() });
  seedManagedRegistry(fixture.registryStore);
  try {
    const client = new FakeNotionClient({
      taskQueryResultsBySourceId: {
        "draft-1:action-1": [{ id: "task-existing-1" }],
        "draft-1:action-2": [{ id: "task-existing-2" }],
      },
    });
    const result = await runNotionUpload({
      settings: notionSettings({ targetUrl: null }),
      selector: { kind: "draft", draftId: fixture.draftId },
      dryRun: false,
      force: false,
      workerId: "writer-test",
      leaseMs: 60000,
      nowIso,
      client,
      readModel: new NotionDraftInputReadModel(fixture.runner),
      writeStore: fixture.writeStore,
      registryStore: fixture.registryStore,
    });
    const taskUpdateIds = client.calls
      .filter((call) => call.method === "updatePage")
      .map((call) => call.pageId)
      .filter((pageId) => pageId?.startsWith("task-existing"));

    assert.equal(result.status, "done");
    assert.equal(client.taskCreatePageBodies.length, 0);
    assert.deepEqual(taskUpdateIds, ["task-existing-1", "task-existing-2"]);
  } finally {
    fixture.close();
  }
});

test("runNotionUpload leaves task worker relation empty when action owner is unmatched", async () => {
  const fixture = createFixture({ actionItems: managedActionItems().slice(0, 1) });
  seedManagedRegistry(fixture.registryStore);
  try {
    const client = new FakeNotionClient({
      memberQueryResultsByName: {
        Taniar: [],
        Ari: [{ id: "member-ari" }],
      },
    });
    const result = await runNotionUpload({
      settings: notionSettings({ targetUrl: null }),
      selector: { kind: "draft", draftId: fixture.draftId },
      dryRun: false,
      force: false,
      workerId: "writer-test",
      leaseMs: 60000,
      nowIso,
      client,
      readModel: new NotionDraftInputReadModel(fixture.runner),
      writeStore: fixture.writeStore,
      registryStore: fixture.registryStore,
    });
    const taskProperties = client.taskCreatePageBodies[0]?.properties as Record<
      string,
      unknown
    >;

    assert.equal(result.status, "done");
    assert.equal("작업자 연결" in taskProperties, false);
    assert.match(result.warnings.join("\n"), /작업자 "Taniar".*찾지 못해/);
  } finally {
    fixture.close();
  }
});

test("runNotionUpload keeps meeting upload done when managed task schema is unhealthy", async () => {
  const fixture = createFixture({ actionItems: managedActionItems() });
  const managedTaskProperties = koreanManagedTaskProperties();
  delete managedTaskProperties["Dirong 액션 ID"];
  seedManagedRegistry(fixture.registryStore);
  try {
    const client = new FakeNotionClient({ managedTaskProperties });
    const result = await runNotionUpload({
      settings: notionSettings({ targetUrl: null }),
      selector: { kind: "draft", draftId: fixture.draftId },
      dryRun: false,
      force: false,
      workerId: "writer-test",
      leaseMs: 60000,
      nowIso,
      client,
      readModel: new NotionDraftInputReadModel(fixture.runner),
      writeStore: fixture.writeStore,
      registryStore: fixture.registryStore,
    });

    assert.equal(result.status, "done");
    assert.equal(client.createPageBodies.length, 1);
    assert.equal(client.taskCreatePageBodies.length, 0);
    assert.match(
      result.warnings.join("\n"),
      /액션 아이템 DB 스키마가 건강하지 않아/,
    );
  } finally {
    fixture.close();
  }
});

test("runNotionUpload resolves relation custom properties and auto-creates missing pages", async () => {
  const fixture = createFixture({
    notionProperties: {
      "프로젝트": { values: ["Project Moonfall"] },
    },
  });
  try {
    const client = new FakeNotionClient({
      relationQueryResults: [],
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
      customPropertyRules: [
        {
          propertyName: "프로젝트",
          propertyId: null,
          propertyType: "relation",
          valueSource: "ai",
          enabled: true,
          promptDescription: "회의에서 언급된 프로젝트 이름",
          maxLength: 1000,
          relationTargetUrl: relationTargetId,
          relationDataSourceId: targetId,
          relationTargetPageUrl: null,
          relationTargetPageId: null,
          relationMatchPropertyName: "Name",
          relationAutoCreate: true,
          lastSeenAt: null,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
      ],
    });
    const properties = client.createPageBodies[0]?.properties as {
      "프로젝트"?: unknown;
    };

    assert.equal(result.status, "done");
    assert.deepEqual(properties["프로젝트"], {
      relation: [{ id: "created-relation-page" }],
    });
    assert.deepEqual(client.relationCreateBodies[0], {
      parent: { data_source_id: relationTargetId },
      properties: {
        Name: {
          title: [{ text: { content: "Project Moonfall" } }],
        },
      },
    });
  } finally {
    fixture.close();
  }
});

test("runNotionUpload writes a fixed relation target page without AI values", async () => {
  const fixture = createFixture();
  try {
    const client = new FakeNotionClient();
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
      customPropertyRules: [
        {
          propertyName: "프로젝트",
          propertyId: null,
          propertyType: "relation",
          valueSource: "ai",
          enabled: true,
          promptDescription: "",
          maxLength: 1000,
          relationTargetUrl: relationTargetId,
          relationDataSourceId: relationTargetId,
          relationTargetPageUrl:
            "https://www.notion.so/workspace/Project-Moonfall-22222222333344445555666666666666",
          relationTargetPageId: null,
          relationMatchPropertyName: "Name",
          relationAutoCreate: false,
          lastSeenAt: null,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
      ],
    });
    const properties = client.createPageBodies[0]?.properties as {
      "프로젝트"?: unknown;
    };

    assert.equal(result.status, "done");
    assert.deepEqual(properties["프로젝트"], {
      relation: [{ id: relationTargetPageId }],
    });
    assert.equal(client.relationCreateBodies.length, 0);
    assert.equal(
      client.calls.filter((call) => call.method === "queryDataSource").length,
      2,
    );
  } finally {
    fixture.close();
  }
});

test("runNotionUpload maps participant source relation from session speakers", async () => {
  const fixture = createFixture({
    speakers: [
      ["Taniar, Admin", 0],
      ["taniar admin", 0],
      ["Ari", 0],
      ["Dirong Bot", 1],
    ],
    notionProperties: {
      Members: { values: ["Ignored AI value"] },
    },
  });
  try {
    const client = new FakeNotionClient({
      relationQueryResults: [],
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
      customPropertyRules: [
        {
          propertyName: "Members",
          propertyId: null,
          propertyType: "relation",
          valueSource: "participants",
          enabled: true,
          promptDescription: "",
          maxLength: 1000,
          relationTargetUrl: relationTargetId,
          relationDataSourceId: relationTargetId,
          relationTargetPageUrl: null,
          relationTargetPageId: null,
          relationMatchPropertyName: "Name",
          relationAutoCreate: true,
          lastSeenAt: null,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
      ],
    });

    assert.equal(result.status, "done");
    assert.deepEqual(
      client.relationCreateBodies.map(readCreatedRelationTitle),
      ["Taniar Admin", "Ari"],
    );
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

test("runNotionUpload reuses a remote page found by Session ID", async () => {
  const fixture = createFixture();
  try {
    const client = new FakeNotionClient({
      queryResultsByProperty: {
        "Draft ID": [],
        "Session ID": [{ id: "existing-page", url: "https://notion.so/existing" }],
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

    assert.equal(result.status, "done");
    assert.equal(result.pageUrl, "https://notion.so/existing");
    assert.equal(
      client.calls.some((call) => call.method === "createPage"),
      false,
    );
    assert.deepEqual(
      client.calls
        .filter((call) => call.method === "queryDataSource")
        .map((call) => readFilterProperty(call.body)),
      ["Draft ID", "Session ID"],
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
  readonly calls: Array<{ method: string; body?: unknown; pageId?: string }> = [];
  readonly createPageBodies: Array<Record<string, unknown>> = [];
  readonly taskCreatePageBodies: Array<Record<string, unknown>> = [];
  readonly relationCreateBodies: Array<Record<string, unknown>> = [];

  constructor(
    private readonly options: {
      queryResults?: unknown[];
      queryResultsByProperty?: Record<string, unknown[]>;
      relationQueryResults?: unknown[];
      memberQueryResultsByName?: Record<string, unknown[]>;
      taskQueryResultsBySourceId?: Record<string, unknown[]>;
      appendError?: NotionApiError;
      properties?: NotionDataSourceProperties;
      managedMeetingProperties?: NotionDataSourceProperties;
      managedMemberProperties?: NotionDataSourceProperties;
      managedTaskProperties?: NotionDataSourceProperties;
    } = {},
  ) {}

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

  async retrieveDataSource(dataSourceId: string = targetId): Promise<Record<string, unknown>> {
    this.calls.push({ method: "retrieveDataSource" });
    if (dataSourceId === relationTargetId) {
      return {
        id: relationTargetId,
        name: "프로젝트",
        properties: {
          Name: { id: "title", type: "title" },
        },
      };
    }
    if (dataSourceId === managedMeetingDataSourceId) {
      return {
        id: managedMeetingDataSourceId,
        name: "회의록",
        properties:
          this.options.managedMeetingProperties ?? koreanManagedMeetingProperties(),
      };
    }
    if (dataSourceId === managedMemberDataSourceId) {
      return {
        id: managedMemberDataSourceId,
        name: "작업자",
        properties:
          this.options.managedMemberProperties ?? koreanManagedMemberProperties(),
      };
    }
    if (dataSourceId === managedTaskDataSourceId) {
      return {
        id: managedTaskDataSourceId,
        name: "액션 아이템",
        properties:
          this.options.managedTaskProperties ?? koreanManagedTaskProperties(),
      };
    }
    return {
      id: targetId,
      name: "회의록",
      properties: this.options.properties ?? completeProperties(),
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
      properties: this.options.properties ?? completeProperties(),
    };
  }

  async queryDataSource(
    dataSourceId: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    this.calls.push({ method: "queryDataSource", body });
    if (dataSourceId === managedMemberDataSourceId) {
      const value = readFilterEquals(body);
      const fallback: Record<string, unknown[]> = {
        Taniar: [{ id: "member-taniar" }],
        Ari: [{ id: "member-ari" }],
      };
      return {
        results:
          (this.options.memberQueryResultsByName ?? fallback)[value ?? ""] ?? [],
      };
    }
    if (dataSourceId === managedTaskDataSourceId) {
      const value = readFilterEquals(body);
      return {
        results:
          this.options.taskQueryResultsBySourceId?.[value ?? ""] ?? [],
      };
    }
    if (dataSourceId === relationTargetId) {
      return { results: this.options.relationQueryResults ?? [] };
    }
    const property = readFilterProperty(body);
    if (property && this.options.queryResultsByProperty?.[property]) {
      return { results: this.options.queryResultsByProperty[property] };
    }
    return { results: this.options.queryResults ?? [] };
  }

  async createPage(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.calls.push({ method: "createPage", body });
    const parent = body.parent;
    if (
      isRecord(parent) &&
      parent.data_source_id === relationTargetId
    ) {
      this.relationCreateBodies.push(body);
      return {
        id: "created-relation-page",
        url: "https://notion.so/created-relation-page",
      };
    }
    if (
      isRecord(parent) &&
      parent.data_source_id === managedTaskDataSourceId
    ) {
      this.taskCreatePageBodies.push(body);
      return {
        id: `task-page-${this.taskCreatePageBodies.length}`,
        url: `https://notion.so/task-page-${this.taskCreatePageBodies.length}`,
      };
    }
    this.createPageBodies.push(body);
    return { id: "page-1", url: "https://notion.so/page-1" };
  }

  async updatePage(
    pageId: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    this.calls.push({ method: "updatePage", pageId, body });
    return { id: pageId, url: `https://notion.so/${pageId}` };
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
  registryStore: NotionRegistryStore;
  sessionId: string;
  draftId: string;
  close: () => void;
};

function createFixture(
  options: Parameters<typeof makeNotionDraftInput>[0] = {},
): WriterFixture {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-notion-writer-"));
  const database = new DirongDatabase(path.join(dir, "dirong.sqlite"), 1000);
  const runner = new SqlRunner(database);
  const writeStore = new NotionWriteStore(runner);
  const registryStore = new NotionRegistryStore(runner);
  const draftInput = makeNotionDraftInput(options);
  insertSession(database, dir, draftInput);
  insertSpeaker(database, draftInput);
  insertAiCleanupJob(database, draftInput);
  insertDraft(database, draftInput);

  return {
    dir,
    database,
    runner,
    writeStore,
    registryStore,
    sessionId: draftInput.session.id,
    draftId: draftInput.draft.id,
    close: () => {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function notionSettings(
  overrides: Partial<NotionRuntimeSettings> = {},
): NotionRuntimeSettings {
  return {
    enabled: true,
    apiKey: "ntn_test_secret",
    apiVersion: "2026-03-11",
    baseUrl: "https://api.notion.com",
    requestTimeoutMs: 30000,
    targetUrl: targetId,
    targetType: "data_source",
    uploadMode: "manual",
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

function managedActionItems(): ReturnType<
  typeof makeNotionDraftInput
>["draftContent"]["actionItems"] {
  const taniarReference = {
    chunkId: "chunk-1",
    sttJobId: "stt-1",
    startMs: 0,
    endMs: 60000,
    speaker: "Taniar",
  };
  const ariReference = {
    chunkId: "chunk-2",
    sttJobId: "stt-2",
    startMs: 62000,
    endMs: 90000,
    speaker: "Ari",
  };
  return [
    {
      id: "action-1",
      task: "Notion writer 테스트를 추가한다.",
      owner: {
        status: "explicit",
        name: "Taniar",
        userId: "user-0",
        evidence: [taniarReference],
      },
      dueDate: {
        status: "unspecified",
        rawText: null,
        isoDate: null,
        evidence: [],
      },
      references: [taniarReference],
    },
    {
      id: "action-2",
      task: "대시보드 복구 버튼을 확인한다.",
      owner: {
        status: "explicit",
        name: "Ari",
        userId: "user-1",
        evidence: [ariReference],
      },
      dueDate: {
        status: "explicit",
        rawText: "2026-05-15",
        isoDate: "2026-05-15",
        evidence: [ariReference],
      },
      references: [ariReference],
    },
  ];
}

function koreanManagedMeetingProperties(
  rename: Record<string, string> = {},
): NotionDataSourceProperties {
  const property = (
    name: string,
    id: string,
    type: string,
    extra: Record<string, unknown> = {},
  ) => ({
    [rename[name] ?? name]: { id, type, ...extra },
  });
  return {
    ...property("회의록", "meeting-title-id", "title"),
    ...property("날짜", "meeting-date-id", "date"),
    ...property("회의 시간", "meeting-time-id", "rich_text"),
    ...property("채널", "meeting-channel-id", "rich_text"),
    ...property("참가자 연결", "meeting-member-relation-id", "relation", {
      relation: { data_source_id: managedMemberDataSourceId },
    }),
    ...property("참가자", "meeting-participants-id", "rollup", {
      rollup: {
        function: "show_original",
        relation_property_id: "meeting-member-relation-id",
        relation_property_name: rename["참가자 연결"] ?? "참가자 연결",
        rollup_property_id: "member-notion-person-id",
        rollup_property_name: "노션 연결",
      },
    }),
    ...property("액션 아이템", "meeting-action-items-id", "relation", {
      relation: { data_source_id: managedTaskDataSourceId },
    }),
    ...property("상태", "meeting-status-id", "select", {
      select: {
        options: NOTION_MEETING_STATUS_OPTIONS.map((name) => ({ name })),
      },
    }),
    ...property("Dirong 세션 ID", "meeting-session-id", "rich_text"),
    ...property("Dirong 초안 ID", "meeting-draft-id", "rich_text"),
    ...property("Dirong 내용 해시", "meeting-hash-id", "rich_text"),
    ...property("Dirong 상태", "meeting-local-status-id", "rich_text"),
  };
}

function koreanManagedMemberProperties(): NotionDataSourceProperties {
  return {
    "디스코드 닉네임": { id: "member-discord-name-id", type: "title" },
    "노션 연결": { id: "member-notion-person-id", type: "people" },
    "소속": { id: "member-organization-id", type: "select" },
    "담당": { id: "member-roles-id", type: "multi_select" },
  };
}

function koreanManagedTaskProperties(
  overrides: Partial<NotionDataSourceProperties> = {},
): NotionDataSourceProperties {
  return {
    작업: { id: "task-title-id", type: "title" },
    회의록: {
      id: "task-meeting-id",
      type: "relation",
      relation: { data_source_id: managedMeetingDataSourceId },
    },
    "작업자 연결": {
      id: "task-worker-relation-id",
      type: "relation",
      relation: { data_source_id: managedMemberDataSourceId },
    },
    담당자: {
      id: "task-assignee-id",
      type: "rollup",
      rollup: {
        function: "show_original",
        relation_property_id: "task-worker-relation-id",
        relation_property_name: "작업자 연결",
        rollup_property_id: "member-notion-person-id",
        rollup_property_name: "노션 연결",
      },
    },
    담당: {
      id: "task-role-id",
      type: "rollup",
      rollup: {
        function: "show_original",
        relation_property_id: "task-worker-relation-id",
        relation_property_name: "작업자 연결",
        rollup_property_id: "member-roles-id",
        rollup_property_name: "담당",
      },
    },
    마감일: { id: "task-due-date-id", type: "date" },
    상태: {
      id: "task-status-id",
      type: "select",
      select: {
        options: ["할 일", "진행 중", "완료"].map((name) => ({ name })),
      },
    },
    근거: { id: "task-evidence-id", type: "rich_text" },
    "Dirong 액션 ID": { id: "task-source-action-id", type: "rich_text" },
    ...overrides,
  };
}

function seedManagedRegistry(
  store: NotionRegistryStore,
  options: {
    meetingPropertyNameOverrides?: Partial<Record<string, string>>;
  } = {},
): void {
  store.saveWorkspaceSettings({
    locale: "ko",
    parentPageUrl:
      "https://www.notion.so/workspace/Dirong-99999999999999999999999999999999",
    parentPageId: "99999999-9999-9999-9999-999999999999",
    nowIso,
  });
  store.upsertManagedDatabase({
    role: "meeting",
    locale: "ko",
    databaseId: "managed-meeting-db",
    dataSourceId: managedMeetingDataSourceId,
    url: "https://notion.so/managed-meeting",
    name: "회의록",
    createdByDirong: true,
    schemaVersion: "notion-managed-db-v1",
    nowIso,
  });
  store.upsertManagedDatabase({
    role: "member",
    locale: "ko",
    databaseId: "managed-member-db",
    dataSourceId: managedMemberDataSourceId,
    url: "https://notion.so/managed-member",
    name: "작업자",
    createdByDirong: true,
    schemaVersion: "notion-managed-db-v1",
    nowIso,
  });
  store.upsertManagedDatabase({
    role: "task",
    locale: "ko",
    databaseId: "managed-task-db",
    dataSourceId: managedTaskDataSourceId,
    url: "https://notion.so/managed-task",
    name: "액션 아이템",
    createdByDirong: true,
    schemaVersion: "notion-managed-db-v1",
    nowIso,
  });

  for (const property of KOREAN_NOTION_SCHEMA_PRESET.databases.meeting.properties) {
    store.upsertPropertyMapping({
      databaseRole: "meeting",
      semanticKey: property.key,
      propertyName:
        options.meetingPropertyNameOverrides?.[property.key] ?? property.name,
      propertyId: null,
      propertyType: property.type,
      locked: property.locked,
      sourceKind: "system",
      nowIso,
    });
  }
  for (const property of KOREAN_NOTION_SCHEMA_PRESET.databases.member.properties) {
    store.upsertPropertyMapping({
      databaseRole: "member",
      semanticKey: property.key,
      propertyName: property.name,
      propertyId: null,
      propertyType: property.type,
      locked: property.locked,
      sourceKind: "system",
      nowIso,
    });
  }
  for (const property of KOREAN_NOTION_SCHEMA_PRESET.databases.task.properties) {
    store.upsertPropertyMapping({
      databaseRole: "task",
      semanticKey: property.key,
      propertyName: property.name,
      propertyId: null,
      propertyType: property.type,
      locked: property.locked,
      sourceKind: "system",
      nowIso,
    });
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFilterProperty(body: unknown): string | null {
  if (!isRecord(body) || !isRecord(body.filter)) {
    return null;
  }
  return typeof body.filter.property === "string" ? body.filter.property : null;
}

function readFilterEquals(body: unknown): string | null {
  if (!isRecord(body) || !isRecord(body.filter)) {
    return null;
  }
  const title = body.filter.title;
  if (isRecord(title) && typeof title.equals === "string") {
    return title.equals;
  }
  const richText = body.filter.rich_text;
  if (isRecord(richText) && typeof richText.equals === "string") {
    return richText.equals;
  }
  return null;
}

function readCreatedRelationTitle(body: unknown): string | null {
  if (!isRecord(body) || !isRecord(body.properties)) {
    return null;
  }
  const name = body.properties.Name;
  if (!isRecord(name) || !Array.isArray(name.title)) {
    return null;
  }
  const first = name.title[0];
  if (!isRecord(first) || !isRecord(first.text)) {
    return null;
  }
  return typeof first.text.content === "string" ? first.text.content : null;
}
