import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SqlRunner } from "../storage/sql-runner.js";
import { DirongDatabase } from "../storage/sqlite.js";
import type { NotionClient, NotionDataSourceResponse } from "./client.js";
import { ManagedNotionSchemaStatusService } from "./managed-schema-status.js";
import {
  KOREAN_NOTION_SCHEMA_PRESET,
  type NotionDatabaseRole,
  type NotionPropertySemanticKey,
  type NotionSchemaPresetProperty,
} from "./schema-presets.js";
import type { NotionDataSourceProperties, NotionDataSourceProperty } from "./schema.js";
import { NotionRegistryStore } from "./registry-store.js";

test("ManagedNotionSchemaStatusService returns healthy remote snapshots without mutating registry", async () => {
  const fixture = createFixture();
  try {
    seedCompleteRegistry(fixture.store);
    const service = new ManagedNotionSchemaStatusService({
      registryStore: fixture.store,
      client: fakeClient({
        "meeting-ds": propertiesForRole("meeting"),
        "member-ds": propertiesForRole("member"),
        "task-ds": propertiesForRole("task"),
      }),
      now: () => new Date("2026-05-12T00:00:00.000Z"),
    });

    const snapshot = await service.checkAll();

    assert.equal(snapshot.status, "healthy");
    assert.deepEqual(
      snapshot.databases.map((database) => [database.role, database.remote.status]),
      [
        ["meeting", "healthy"],
        ["member", "healthy"],
        ["task", "healthy"],
      ],
    );
    assert.equal(
      fixture.store.getPropertyMapping("meeting", "meeting.date")?.propertyId,
      propertyId("meeting.date"),
    );
  } finally {
    fixture.close();
  }
});

test("ManagedNotionSchemaStatusService preserves registry when Notion API fails", async () => {
  const fixture = createFixture();
  try {
    seedCompleteRegistry(fixture.store);
    const service = new ManagedNotionSchemaStatusService({
      registryStore: fixture.store,
      client: fakeClient({}, new Error("network failed ntn_secret_should_redact")),
      now: () => new Date("2026-05-12T00:00:00.000Z"),
    });

    const snapshot = await service.checkAll();

    assert.equal(snapshot.status, "failed");
    assert.deepEqual(
      snapshot.databases.map((database) => database.remote.status),
      ["failed", "failed", "failed"],
    );
    assert.match(snapshot.databases[0]?.remote.error ?? "", /network failed/);
    assert.doesNotMatch(snapshot.databases[0]?.remote.error ?? "", /ntn_secret_should_redact/);
    assert.equal(
      fixture.store.getPropertyMapping("meeting", "meeting.date")?.propertyId,
      propertyId("meeting.date"),
    );
  } finally {
    fixture.close();
  }
});

function createFixture(): {
  store: NotionRegistryStore;
  close: () => void;
} {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-notion-managed-status-"));
  const database = new DirongDatabase(path.join(dir, "dirong.sqlite"), 1000);
  return {
    store: new NotionRegistryStore(new SqlRunner(database)),
    close: () => {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function seedCompleteRegistry(store: NotionRegistryStore): void {
  const nowIso = "2026-05-12T00:00:00.000Z";
  store.saveWorkspaceSettings({
    locale: "ko",
    parentPageUrl: "https://www.notion.so/workspace/Dirong-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    parentPageId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    nowIso,
  });
  for (const role of ["meeting", "member", "task"] as const) {
    store.upsertManagedDatabase({
      role,
      locale: "ko",
      databaseId: `${role}-db`,
      dataSourceId: `${role}-ds`,
      url: `https://notion.so/${role}`,
      name: KOREAN_NOTION_SCHEMA_PRESET.databases[role].name,
      createdByDirong: true,
      schemaVersion: "notion-managed-db-v1",
      nowIso,
    });
    for (const property of KOREAN_NOTION_SCHEMA_PRESET.databases[role].properties) {
      store.upsertPropertyMapping({
        databaseRole: role,
        semanticKey: property.key,
        propertyName: property.name,
        propertyId: propertyId(property.key),
        propertyType: property.type,
        locked: property.locked,
        sourceKind: property.type === "rollup" ? "rollup" : "system",
        nowIso,
      });
    }
  }
}

function fakeClient(
  dataSources: Record<string, NotionDataSourceProperties>,
  error: Error | null = null,
): NotionClient {
  return {
    retrieveDataSource: async (dataSourceId) => {
      if (error) {
        throw error;
      }
      return { id: dataSourceId, properties: dataSources[dataSourceId] ?? {} };
    },
    retrievePage: notImplemented,
    retrieveDatabase: notImplemented,
    createDatabase: notImplemented,
    createDataSource: notImplemented,
    updateDataSource: notImplemented,
    queryDataSource: notImplemented,
    createPage: notImplemented,
    updatePage: notImplemented,
    appendBlockChildren: notImplemented,
    retrieveBlockChildren: notImplemented,
  };
}

async function notImplemented(): Promise<NotionDataSourceResponse> {
  throw new Error("not implemented");
}

function propertiesForRole(role: NotionDatabaseRole): NotionDataSourceProperties {
  const properties: NotionDataSourceProperties = {};
  for (const property of KOREAN_NOTION_SCHEMA_PRESET.databases[role].properties) {
    properties[property.name] = actualProperty(property);
  }
  return properties;
}

function actualProperty(
  property: NotionSchemaPresetProperty,
): NotionDataSourceProperty {
  const base = {
    id: propertyId(property.key),
    name: property.name,
    type: property.type,
  };
  if (property.type === "relation") {
    return {
      ...base,
      relation: {
        data_source_id: `${property.relation?.targetDatabase}-ds`,
      },
    };
  }
  if (property.type === "rollup") {
    assert.ok(property.rollup);
    return {
      ...base,
      rollup: {
        function: "show_original",
        relation_property_id: propertyId(property.rollup.relationProperty),
        relation_property_name: propertyName(property.rollup.relationProperty),
        rollup_property_id: propertyId(property.rollup.targetProperty),
        rollup_property_name: propertyName(property.rollup.targetProperty),
      },
    };
  }
  if (
    property.type === "select" ||
    property.type === "status" ||
    property.type === "multi_select"
  ) {
    return {
      ...base,
      [property.type]: {
        options: (property.options ?? []).map((name) => ({
          id: `${name}-id`,
          name,
          color: "gray",
        })),
      },
    };
  }
  return {
    ...base,
    [property.type]: {},
  };
}

function propertyName(key: NotionPropertySemanticKey): string {
  for (const database of Object.values(KOREAN_NOTION_SCHEMA_PRESET.databases)) {
    const property = database.properties.find((item) => item.key === key);
    if (property) {
      return property.name;
    }
  }
  throw new Error(`missing property fixture: ${key}`);
}

function propertyId(key: NotionPropertySemanticKey): string {
  return `prop-${key.replaceAll(".", "-")}`;
}
