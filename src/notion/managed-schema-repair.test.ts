import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SqlRunner } from "../storage/sql-runner.js";
import { DirongDatabase } from "../storage/sqlite.js";
import type { NotionClient, NotionDataSourceResponse } from "./client.js";
import {
  applyManagedSchemaRepair,
  buildManagedSchemaRepairPlan,
  ManagedSchemaRepairStalePlanError,
} from "./managed-schema-repair.js";
import { buildManagedSchemaDiff } from "./managed-schema-diff.js";
import {
  KOREAN_NOTION_SCHEMA_PRESET,
  type NotionDatabaseRole,
  type NotionPropertySemanticKey,
  type NotionSchemaPresetProperty,
} from "./schema-presets.js";
import type { NotionDataSourceProperties, NotionDataSourceProperty } from "./schema.js";
import {
  NOTION_MANAGED_SCHEMA_VERSION,
} from "./managed-schema.js";
import {
  NotionRegistryStore,
  type NotionManagedDatabase,
  type NotionPropertyMapping,
} from "./registry-store.js";

test("managed schema repair plan creates missing non-title properties", () => {
  const properties = propertiesForRole("meeting");
  delete properties["날짜"];
  delete properties["회의 시간"];
  delete properties["상태"];
  const plan = planFor("meeting", properties);

  assert.deepEqual(
    plan.operations.map((operation) => [operation.kind, operation.semanticKey]),
    [
      ["create_property", "meeting.date"],
      ["create_property", "meeting.time"],
      ["create_property", "meeting.status"],
    ],
  );
  assert.equal(plan.body?.properties["날짜"] !== undefined, true);
  assert.equal(plan.body?.properties["상태"] !== undefined, true);
  assert.deepEqual(plan.body?.properties["날짜"], {
    type: "date",
    date: {},
  });
  assert.deepEqual(plan.body?.properties["상태"], {
    type: "select",
    select: {
      options: [
        { name: "draft", color: "gray" },
        { name: "done", color: "green" },
        { name: "retry_wait", color: "yellow" },
        { name: "failed", color: "red" },
      ],
    },
  });
});

test("managed schema repair plan creates missing meeting action item relation", () => {
  const properties = propertiesForRole("meeting");
  delete properties["할 일 목록"];
  const plan = planFor("meeting", properties);

  assert.deepEqual(
    plan.operations.map((operation) => [operation.kind, operation.semanticKey]),
    [["create_property", "meeting.actionItems"]],
  );
  assert.equal(plan.body, null);
  assert.equal(plan.operations[0]?.patch, null);
});

test("managed schema repair plan syncs stale relation mapping without Notion schema edits", () => {
  const properties = propertiesForRole("meeting");
  properties["할 일 목록"] = {
    ...properties["할 일 목록"],
    id: "remote-action-items-id",
  };
  const plan = planFor("meeting", properties, staleActionItemsMappings());

  assert.deepEqual(
    plan.operations.map((operation) => [operation.kind, operation.semanticKey]),
    [["sync_mapping", "meeting.actionItems"]],
  );
  assert.equal(plan.body, null);
});

test("managed schema repair plan blocks missing title properties", () => {
  const properties = propertiesForRole("meeting");
  delete properties["회의록"];
  const plan = planFor("meeting", properties);

  assert.equal(plan.status, "blocked");
  assert.deepEqual(
    plan.blocked.map((item) => [item.code, item.semanticKey]),
    [["remote_missing", "meeting.title"]],
  );
  assert.equal(plan.body, null);
});

test("managed schema repair plan never deletes extra properties", () => {
  const plan = planFor("meeting", {
    ...propertiesForRole("meeting"),
    Scratch: { id: "scratch-id", name: "Scratch", type: "rich_text" },
  });

  assert.equal(plan.body, null);
  assert.deepEqual(plan.operations, []);
  assert.match(plan.warnings.join(" "), /자동 삭제하지 않습니다/);
});

test("managed schema repair apply rejects stale plan hashes before updating Notion", async () => {
  const fixture = createFixture();
  try {
    seedCompleteRegistry(fixture.store);
    const properties = propertiesForRole("meeting");
    delete properties["날짜"];
    const client = fakeClient([properties]);

    await assert.rejects(
      () =>
        applyManagedSchemaRepair({
          client,
          registryStore: fixture.store,
          role: "meeting",
          expectedPlanHash: "stale",
        }),
      ManagedSchemaRepairStalePlanError,
    );
    assert.equal(client.updateCalls.length, 0);
  } finally {
    fixture.close();
  }
});

test("managed schema repair apply updates registry only after remote confirmation", async () => {
  const fixture = createFixture();
  try {
    seedCompleteRegistry(fixture.store);
    const before = propertiesForRole("meeting");
    delete before["날짜"];
    const after = propertiesForRole("meeting");
    after["날짜"] = { ...after["날짜"], id: "new-date-id" };
    const plan = planFor("meeting", before);
    const client = fakeClient([before, after]);

    const result = await applyManagedSchemaRepair({
      client,
      registryStore: fixture.store,
      role: "meeting",
      expectedPlanHash: plan.planHash,
      nowIso: "2026-05-12T00:01:00.000Z",
    });

    assert.equal(result.status, "done");
    assert.deepEqual(result.appliedOperationIds, ["create_property:meeting.date"]);
    assert.deepEqual(result.registryUpdated.map((item) => item.semanticKey), [
      "meeting.date",
    ]);
    assert.equal(
      fixture.store.getPropertyMapping("meeting", "meeting.date")?.propertyId,
      "new-date-id",
    );
    assert.equal(client.updateCalls.length, 1);
  } finally {
    fixture.close();
  }
});

test("managed schema repair apply keeps registry unchanged when Notion update fails", async () => {
  const fixture = createFixture();
  try {
    seedCompleteRegistry(fixture.store);
    const before = propertiesForRole("meeting");
    delete before["날짜"];
    const plan = planFor("meeting", before);
    const client = fakeClient([before], new Error("Notion update failed"));

    await assert.rejects(
      () =>
        applyManagedSchemaRepair({
          client,
          registryStore: fixture.store,
          role: "meeting",
          expectedPlanHash: plan.planHash,
        }),
      /Notion update failed/,
    );
    assert.equal(
      fixture.store.getPropertyMapping("meeting", "meeting.date")?.propertyId,
      propertyId("meeting.date"),
    );
  } finally {
    fixture.close();
  }
});

test("managed schema repair apply creates meeting action items from task relation", async () => {
  const fixture = createFixture();
  try {
    seedCompleteRegistry(fixture.store);
    const before = propertiesForRole("meeting");
    delete before["할 일 목록"];
    const generated = propertiesForRole("meeting");
    generated["할 일 목록 1"] = {
      ...generated["할 일 목록"],
      id: "generated-action-items-id",
      name: "할 일 목록 1",
    };
    delete generated["할 일 목록"];
    const after = propertiesForRole("meeting");
    after["할 일 목록"] = {
      ...after["할 일 목록"],
      id: "generated-action-items-id",
    };
    const plan = planFor("meeting", before);
    const client = fakeClient([before, generated, after]);

    const result = await applyManagedSchemaRepair({
      client,
      registryStore: fixture.store,
      role: "meeting",
      expectedPlanHash: plan.planHash,
      nowIso: "2026-05-12T00:01:00.000Z",
    });

    assert.equal(result.status, "done");
    assert.deepEqual(result.registryUpdated.map((item) => item.semanticKey), [
      "meeting.actionItems",
    ]);
    assert.equal(
      fixture.store.getPropertyMapping("meeting", "meeting.actionItems")
        ?.propertyId,
      "generated-action-items-id",
    );
    assert.equal(client.updateCalls[0]?.dataSourceId, "task-ds");
    assert.deepEqual(
      readUpdateProperty(client.updateCalls[0]?.body, "회의록"),
      {
        type: "relation",
        relation: {
          data_source_id: "meeting-ds",
          type: "dual_property",
          dual_property: {
            synced_property_name: "할 일 목록",
          },
        },
      },
    );
    assert.equal(client.updateCalls[1]?.dataSourceId, "meeting-ds");
    assert.deepEqual(
      readUpdateProperty(client.updateCalls[1]?.body, "generated-action-items-id"),
      { name: "할 일 목록" },
    );
  } finally {
    fixture.close();
  }
});

test("managed schema repair apply syncs stale relation mapping without updating Notion", async () => {
  const fixture = createFixture();
  try {
    seedCompleteRegistry(fixture.store);
    const properties = propertiesForRole("meeting");
    properties["할 일 목록"] = {
      ...properties["할 일 목록"],
      id: "remote-action-items-id",
    };
    const plan = planFor("meeting", properties);
    const client = fakeClient([properties, properties]);

    const result = await applyManagedSchemaRepair({
      client,
      registryStore: fixture.store,
      role: "meeting",
      expectedPlanHash: plan.planHash,
      nowIso: "2026-05-12T00:01:00.000Z",
    });

    assert.equal(result.status, "done");
    assert.deepEqual(result.appliedOperationIds, [
      "sync_mapping:meeting.actionItems",
    ]);
    assert.equal(client.updateCalls.length, 0);
    assert.equal(
      fixture.store.getPropertyMapping("meeting", "meeting.actionItems")
        ?.propertyId,
      "remote-action-items-id",
    );
  } finally {
    fixture.close();
  }
});

test("managed schema repair apply fails when Notion response still misses selected property", async () => {
  const fixture = createFixture();
  try {
    seedCompleteRegistry(fixture.store);
    const before = propertiesForRole("meeting");
    delete before["할 일 목록"];
    const plan = planFor("meeting", before);
    const client = fakeClient([before, before]);

    const result = await applyManagedSchemaRepair({
      client,
      registryStore: fixture.store,
      role: "meeting",
      expectedPlanHash: plan.planHash,
      nowIso: "2026-05-12T00:01:00.000Z",
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, "failed");
    assert.match(result.userAction ?? "", /할 일 목록/);
    assert.equal(
      fixture.store.getPropertyMapping("meeting", "meeting.actionItems")
        ?.propertyId,
      propertyId("meeting.actionItems"),
    );
  } finally {
    fixture.close();
  }
});

function planFor(
  role: NotionDatabaseRole,
  properties: NotionDataSourceProperties,
  mappings: NotionPropertyMapping[] = mappingsForAllRoles(),
) {
  const diff = buildManagedSchemaDiff({
    databaseRole: role,
    properties,
    mappings,
    managedDatabases: managedDatabases(),
  });
  return buildManagedSchemaRepairPlan({
    role,
    diff,
    mappings,
    managedDatabases: managedDatabases(),
  });
}

function createFixture(): {
  store: NotionRegistryStore;
  close: () => void;
} {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-notion-repair-"));
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
  for (const database of managedDatabases()) {
    store.upsertManagedDatabase({
      role: database.role,
      locale: database.locale,
      databaseId: database.databaseId,
      dataSourceId: database.dataSourceId,
      url: database.url,
      name: database.name,
      createdByDirong: database.createdByDirong,
      schemaVersion: database.schemaVersion,
      nowIso,
    });
  }
  for (const mapping of mappingsForAllRoles()) {
    store.upsertPropertyMapping({
      databaseRole: mapping.databaseRole,
      semanticKey: mapping.semanticKey,
      propertyName: mapping.propertyName,
      propertyId: mapping.propertyId,
      propertyType: mapping.propertyType,
      locked: mapping.locked,
      sourceKind: mapping.sourceKind,
      nowIso,
    });
  }
}

function fakeClient(
  retrieveResults: NotionDataSourceProperties[],
  updateError: Error | null = null,
): NotionClient & { updateCalls: Array<{ dataSourceId: string; body: unknown }> } {
  const updateCalls: Array<{ dataSourceId: string; body: unknown }> = [];
  let retrieveIndex = 0;
  return {
    updateCalls,
    retrieveDataSource: async (dataSourceId) => ({
      id: dataSourceId,
      properties:
        retrieveResults[Math.min(retrieveIndex++, retrieveResults.length - 1)] ?? {},
    }),
    updateDataSource: async (dataSourceId, body) => {
      updateCalls.push({ dataSourceId, body });
      if (updateError) {
        throw updateError;
      }
      return { id: "meeting-ds", properties: {} };
    },
    retrievePage: notImplemented,
    retrieveDatabase: notImplemented,
    createDatabase: notImplemented,
    createDataSource: notImplemented,
    queryDataSource: notImplemented,
    createPage: notImplemented,
    updatePage: notImplemented,
    appendBlockChildren: notImplemented,
    retrieveBlockChildren: notImplemented,
  };
}

function readUpdateProperty(body: unknown, propertyName: string): unknown {
  assert.equal(typeof body, "object");
  assert.notEqual(body, null);
  assert.equal(Array.isArray(body), false);
  const properties = (body as { properties?: unknown }).properties;
  assert.equal(typeof properties, "object");
  assert.notEqual(properties, null);
  assert.equal(Array.isArray(properties), false);
  return (properties as Record<string, unknown>)[propertyName];
}

async function notImplemented(): Promise<NotionDataSourceResponse> {
  throw new Error("not implemented");
}

function managedDatabases(): NotionManagedDatabase[] {
  return (["meeting", "member", "task"] as const).map((role) => ({
    role,
    locale: "ko",
    databaseId: `${role}-db`,
    dataSourceId: `${role}-ds`,
    url: `https://notion.so/${role}`,
    name: KOREAN_NOTION_SCHEMA_PRESET.databases[role].name,
    createdByDirong: true,
    schemaVersion: NOTION_MANAGED_SCHEMA_VERSION,
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:00.000Z",
  }));
}

function mappingsForAllRoles(): NotionPropertyMapping[] {
  return (["meeting", "member", "task"] as const).flatMap((role) =>
    KOREAN_NOTION_SCHEMA_PRESET.databases[role].properties.map((property) => ({
      databaseRole: role,
      semanticKey: property.key,
      propertyName: property.name,
      propertyId: propertyId(property.key),
      propertyType: property.type,
      locked: property.locked,
      sourceKind: property.type === "rollup" ? "rollup" : "system",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
    })),
  );
}

function staleActionItemsMappings(): NotionPropertyMapping[] {
  return mappingsForAllRoles().map((mapping) =>
    mapping.semanticKey === "meeting.actionItems"
      ? { ...mapping, propertyId: "stale-action-items-id" }
      : mapping,
  );
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
