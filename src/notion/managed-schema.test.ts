import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type {
  JsonObject,
  NotionClient,
  NotionDatabaseResponse,
  NotionDataSourceResponse,
} from "./client.js";
import {
  createManagedNotionSchema,
  NOTION_MANAGED_SCHEMA_VERSION,
} from "./managed-schema.js";
import { NotionRegistryStore } from "./registry-store.js";
import { KOREAN_NOTION_SCHEMA_PRESET } from "./schema-presets.js";
import { SqlRunner } from "../storage/sql-runner.js";
import { DirongDatabase } from "../storage/sqlite.js";

const nowIso = "2026-05-10T00:00:00.000Z";
const parentPageUrl =
  "https://www.notion.so/workspace/Dirong-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?pvs=4";
const parentPageId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

test("createManagedNotionSchema stores parent page and creates DBs in managed order", async () => {
  const fixture = createFixture();
  const client = new FakeNotionClient();
  try {
    const result = await createManagedNotionSchema({
      client,
      registryStore: fixture.store,
      parentPageUrl,
      nowIso,
    });

    assert.equal(result.parentPageId, parentPageId);
    assert.equal(fixture.store.getWorkspaceSettings()?.parentPageId, parentPageId);
    assert.deepEqual(
      client.calls
        .filter((call) => call.method === "createDatabase")
        .map((call) => readDatabaseTitle(call.body)),
      ["작업자", "회의록", "액션 아이템"],
    );
    assert.equal(result.databases.member.dataSourceId, "member-ds");
    assert.equal(result.databases.meeting.dataSourceId, "meeting-ds");
    assert.equal(result.databases.task.dataSourceId, "task-ds");
  } finally {
    fixture.close();
  }
});

test("createManagedNotionSchema sends Korean preset fields and resolved relation/rollup targets", async () => {
  const fixture = createFixture();
  const client = new FakeNotionClient();
  try {
    await createManagedNotionSchema({
      client,
      registryStore: fixture.store,
      parentPageUrl,
      nowIso,
    });

    const createBodies = client.calls
      .filter((call) => call.method === "createDatabase")
      .map((call) => requireRecord(call.body));
    const memberBody = createBodies[0];
    const meetingBody = createBodies[1];
    const taskBody = createBodies[2];
    assert.ok(memberBody);
    assert.ok(meetingBody);
    assert.ok(taskBody);

    const memberProperties = readInitialProperties(memberBody);
    assert.deepEqual(Object.keys(memberProperties), [
      "디스코드 닉네임",
      "노션 연결",
      "소속",
      "담당",
    ]);

    const meetingProperties = readInitialProperties(meetingBody);
    assert.ok("회의록" in meetingProperties);
    assert.ok("날짜" in meetingProperties);
    assert.ok("참가자 연결" in meetingProperties);
    assert.deepEqual(
      requireRecord(requireRecord(meetingProperties["참가자 연결"]).relation)
        .data_source_id,
      "member-ds",
    );
    assert.deepEqual(requireRecord(meetingProperties["참가자"]).rollup, {
      function: "show_original",
      relation_property_name: "참가자 연결",
      rollup_property_id: "member-ds:노션 연결",
      rollup_property_name: "노션 연결",
    });

    const taskProperties = readInitialProperties(taskBody);
    assert.deepEqual(
      requireRecord(requireRecord(taskProperties["회의록"]).relation)
        .data_source_id,
      "meeting-ds",
    );
    assert.deepEqual(
      requireRecord(requireRecord(taskProperties["작업자 연결"]).relation)
        .data_source_id,
      "member-ds",
    );
    assert.deepEqual(requireRecord(taskProperties["담당자"]).rollup, {
      function: "show_original",
      relation_property_name: "작업자 연결",
      rollup_property_id: "member-ds:노션 연결",
      rollup_property_name: "노션 연결",
    });
    assert.deepEqual(requireRecord(taskProperties["담당"]).rollup, {
      function: "show_original",
      relation_property_name: "작업자 연결",
      rollup_property_id: "member-ds:담당",
      rollup_property_name: "담당",
    });

    const updateBody = requireRecord(
      client.calls.find((call) => call.method === "updateDataSource")?.body,
    );
    const actionItems = requireRecord(
      requireRecord(updateBody.properties)["액션 아이템"],
    );
    assert.deepEqual(requireRecord(actionItems.relation), {
      data_source_id: "task-ds",
      type: "dual_property",
      dual_property: {
        synced_property_id: "task-ds:회의록",
        synced_property_name: "회의록",
      },
    });
  } finally {
    fixture.close();
  }
});

test("createManagedNotionSchema stores managed databases and semantic property mappings", async () => {
  const fixture = createFixture();
  const client = new FakeNotionClient();
  try {
    await createManagedNotionSchema({
      client,
      registryStore: fixture.store,
      parentPageUrl,
      nowIso,
    });

    assert.deepEqual(
      fixture.store.listManagedDatabases().map((database) => ({
        role: database.role,
        locale: database.locale,
        dataSourceId: database.dataSourceId,
        schemaVersion: database.schemaVersion,
      })),
      [
        {
          role: "meeting",
          locale: "ko",
          dataSourceId: "meeting-ds",
          schemaVersion: NOTION_MANAGED_SCHEMA_VERSION,
        },
        {
          role: "member",
          locale: "ko",
          dataSourceId: "member-ds",
          schemaVersion: NOTION_MANAGED_SCHEMA_VERSION,
        },
        {
          role: "task",
          locale: "ko",
          dataSourceId: "task-ds",
          schemaVersion: NOTION_MANAGED_SCHEMA_VERSION,
        },
      ],
    );

    assert.equal(
      fixture.store.getManagedDatabase("meeting")?.databaseId,
      "meeting-db",
    );
    assert.equal(
      fixture.store.getPropertyMapping("meeting", "meeting.title")?.propertyName,
      "회의록",
    );
    assert.equal(
      fixture.store.getPropertyMapping("meeting", "meeting.actionItems")
        ?.propertyId,
      "meeting-ds:액션 아이템",
    );
    assert.equal(
      fixture.store.getPropertyMapping("task", "task.assignee")?.sourceKind,
      "rollup",
    );
    assert.deepEqual(
      fixture.store.listPropertyMappings("member").map((mapping) => mapping.semanticKey),
      KOREAN_NOTION_SCHEMA_PRESET.databases.member.properties.map(
        (property) => property.key,
      ),
    );
  } finally {
    fixture.close();
  }
});

test("createManagedNotionSchema does not partially save registry on Notion API failure", async () => {
  const fixture = createFixture();
  const client = new FakeNotionClient({ failOnMethod: "updateDataSource" });
  try {
    await assert.rejects(
      createManagedNotionSchema({
        client,
        registryStore: fixture.store,
        parentPageUrl,
        nowIso,
      }),
      /updateDataSource failed/,
    );

    assert.equal(fixture.store.getWorkspaceSettings(), null);
    assert.deepEqual(fixture.store.listManagedDatabases(), []);
    assert.deepEqual(fixture.store.listPropertyMappings(), []);
  } finally {
    fixture.close();
  }
});

type FakeCall = {
  method: string;
  id?: string;
  body?: unknown;
};

class FakeNotionClient implements NotionClient {
  readonly calls: FakeCall[] = [];
  private readonly dataSources = new Map<string, JsonObject>();

  constructor(private readonly options: { failOnMethod?: string } = {}) {}

  async retrievePage(pageId: string): Promise<JsonObject> {
    this.calls.push({ method: "retrievePage", id: pageId });
    this.failIfRequested("retrievePage");
    return { object: "page", id: pageId };
  }

  async retrieveDatabase(databaseId: string): Promise<NotionDatabaseResponse> {
    this.calls.push({ method: "retrieveDatabase", id: databaseId });
    this.failIfRequested("retrieveDatabase");
    const role = roleFromId(databaseId);
    return {
      object: "database",
      id: databaseId,
      data_sources: [{ id: `${role}-ds`, name: role }],
    };
  }

  async createDatabase(body: JsonObject): Promise<NotionDatabaseResponse> {
    this.calls.push({ method: "createDatabase", body });
    this.failIfRequested("createDatabase");
    const role = roleFromDatabaseTitle(readDatabaseTitle(body));
    const databaseId = `${role}-db`;
    const dataSourceId = `${role}-ds`;
    this.dataSources.set(dataSourceId, {
      object: "data_source",
      id: dataSourceId,
      properties: materializeProperties(
        dataSourceId,
        readInitialProperties(body),
      ),
    });
    return {
      object: "database",
      id: databaseId,
      url: `https://notion.so/${role}`,
      data_sources: [{ id: dataSourceId, name: role }],
    };
  }

  async createDataSource(body: JsonObject): Promise<NotionDataSourceResponse> {
    this.calls.push({ method: "createDataSource", body });
    this.failIfRequested("createDataSource");
    return { object: "data_source", id: "extra-ds", properties: {} };
  }

  async retrieveDataSource(dataSourceId: string): Promise<NotionDataSourceResponse> {
    this.calls.push({ method: "retrieveDataSource", id: dataSourceId });
    this.failIfRequested("retrieveDataSource");
    const dataSource = this.dataSources.get(dataSourceId);
    if (!dataSource) {
      throw new Error(`unknown data source ${dataSourceId}`);
    }
    return dataSource;
  }

  async updateDataSource(
    dataSourceId: string,
    body: JsonObject,
  ): Promise<NotionDataSourceResponse> {
    this.calls.push({ method: "updateDataSource", id: dataSourceId, body });
    this.failIfRequested("updateDataSource");
    const dataSource = this.dataSources.get(dataSourceId);
    if (!dataSource) {
      throw new Error(`unknown data source ${dataSourceId}`);
    }
    const existingProperties = requireRecord(dataSource.properties);
    Object.assign(
      existingProperties,
      materializeProperties(dataSourceId, readUpdateProperties(body)),
    );
    return dataSource;
  }

  async queryDataSource(): Promise<JsonObject> {
    this.calls.push({ method: "queryDataSource" });
    return { results: [] };
  }

  async createPage(): Promise<JsonObject> {
    this.calls.push({ method: "createPage" });
    return { id: "page-1" };
  }

  async updatePage(): Promise<JsonObject> {
    this.calls.push({ method: "updatePage" });
    return { id: "page-1" };
  }

  async appendBlockChildren(): Promise<JsonObject> {
    this.calls.push({ method: "appendBlockChildren" });
    return { results: [] };
  }

  async retrieveBlockChildren(): Promise<JsonObject> {
    this.calls.push({ method: "retrieveBlockChildren" });
    return { results: [] };
  }

  private failIfRequested(method: string): void {
    if (this.options.failOnMethod === method) {
      throw new Error(`${method} failed`);
    }
  }
}

function materializeProperties(
  dataSourceId: string,
  properties: JsonObject,
): JsonObject {
  return Object.fromEntries(
    Object.entries(properties).map(([name, config]) => {
      const propertyConfig = requireRecord(config);
      const type = inferPropertyType(propertyConfig);
      return [
        name,
        {
          id: type === "title" ? "title" : `${dataSourceId}:${name}`,
          name,
          type,
          [type]: propertyConfig[type] ?? {},
        },
      ];
    }),
  );
}

function inferPropertyType(config: JsonObject): string {
  for (const type of [
    "title",
    "rich_text",
    "date",
    "people",
    "select",
    "multi_select",
    "status",
    "relation",
    "rollup",
  ]) {
    if (type in config) {
      return type;
    }
  }
  throw new Error(`unknown property config ${JSON.stringify(config)}`);
}

function readDatabaseTitle(body: unknown): string {
  const title = requireRecord(body).title;
  assert.ok(Array.isArray(title));
  const first = requireRecord(title[0]);
  const text = requireRecord(first.text);
  assert.equal(typeof text.content, "string");
  return text.content as string;
}

function readInitialProperties(body: unknown): JsonObject {
  const initialDataSource = requireRecord(requireRecord(body).initial_data_source);
  return requireRecord(initialDataSource.properties);
}

function readUpdateProperties(body: unknown): JsonObject {
  return requireRecord(requireRecord(body).properties);
}

function roleFromDatabaseTitle(title: string): "meeting" | "member" | "task" {
  if (title === "회의록") {
    return "meeting";
  }
  if (title === "작업자") {
    return "member";
  }
  if (title === "액션 아이템") {
    return "task";
  }
  throw new Error(`unknown database title ${title}`);
}

function roleFromId(id: string): "meeting" | "member" | "task" {
  if (id.startsWith("meeting")) {
    return "meeting";
  }
  if (id.startsWith("member")) {
    return "member";
  }
  return "task";
}

function requireRecord(value: unknown): JsonObject {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as JsonObject;
}

function createFixture(): {
  store: NotionRegistryStore;
  close: () => void;
} {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-managed-schema-"));
  const database = new DirongDatabase(path.join(dir, "dirong.sqlite"), 1000);
  return {
    store: new NotionRegistryStore(new SqlRunner(database)),
    close: () => {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
