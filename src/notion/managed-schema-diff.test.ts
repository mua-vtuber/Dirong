import assert from "node:assert/strict";
import test from "node:test";
import {
  buildManagedSchemaDiff,
  requiredSemanticKeysForManagedRole,
  validateManagedDataSourceSchemaForUpload,
} from "./managed-schema-diff.js";
import {
  KOREAN_NOTION_SCHEMA_PRESET,
  type NotionDatabaseRole,
  type NotionPropertySemanticKey,
  type NotionSchemaPresetProperty,
} from "./schema-presets.js";
import type { NotionDataSourceProperties, NotionDataSourceProperty } from "./schema.js";
import type {
  NotionManagedDatabase,
  NotionPropertyMapping,
} from "./registry-store.js";

test("managed schema diff reports healthy when registry mappings and remote schema match", () => {
  const diff = buildManagedSchemaDiff({
    databaseRole: "meeting",
    properties: propertiesForRole("meeting"),
    mappings: mappingsForAllRoles(),
    managedDatabases: managedDatabases(),
  });

  assert.equal(diff.status, "healthy");
  assert.equal(diff.healthy, true);
  assert.deepEqual(
    diff.resolvedProperties.map((property) => property.semanticKey),
    requiredSemanticKeysForManagedRole("meeting"),
  );
});

test("managed schema diff accepts rollup references when ids differ but names match", () => {
  const properties = propertiesForRole("task");
  for (const propertyName of ["담당자", "담당"]) {
    const property = properties[propertyName];
    assert.ok(property);
    assert.ok(property.rollup);
    properties[propertyName] = {
      ...property,
      rollup: {
        ...property.rollup,
        relation_property_id: `${propertyName}-relation-id-from-notion`,
        rollup_property_id: `${propertyName}-target-id-from-notion`,
      },
    };
  }

  const diff = buildManagedSchemaDiff({
    databaseRole: "task",
    properties,
    mappings: mappingsForAllRoles(),
    managedDatabases: managedDatabases(),
  });

  assert.equal(diff.status, "healthy");
  assert.equal(
    diff.issues.some((issue) => issue.code === "rollup_target_mismatch"),
    false,
  );
});

test("managed schema diff treats deleted remote properties as repairable", () => {
  const properties = propertiesForRole("meeting");
  delete properties["날짜"];

  const diff = buildManagedSchemaDiff({
    databaseRole: "meeting",
    properties,
    mappings: mappingsForAllRoles(),
    managedDatabases: managedDatabases(),
  });

  assert.equal(diff.status, "needs_repair");
  assert.deepEqual(
    diff.issues
      .filter((issue) => issue.code === "remote_missing")
      .map((issue) => issue.semanticKey),
    ["meeting.date"],
  );
});

test("managed schema diff detects id-backed name drift", () => {
  const properties = propertiesForRole("meeting");
  properties["날짜"] = {
    ...properties["날짜"],
    name: "회의일",
  };

  const diff = buildManagedSchemaDiff({
    databaseRole: "meeting",
    properties,
    mappings: mappingsForAllRoles(),
    managedDatabases: managedDatabases(),
  });

  assert.equal(diff.status, "needs_repair");
  assert.deepEqual(
    diff.issues
      .filter((issue) => issue.code === "name_drift")
      .map((issue) => [issue.semanticKey, issue.expected, issue.actual]),
    [["meeting.date", "날짜", "회의일"]],
  );
});

test("managed schema diff marks relation target mismatch as manual required", () => {
  const properties = propertiesForRole("meeting");
  properties["참가자 연결"] = {
    ...properties["참가자 연결"],
    relation: {
      data_source_id: "wrong-member-ds",
    },
  };

  const diff = buildManagedSchemaDiff({
    databaseRole: "meeting",
    properties,
    mappings: mappingsForAllRoles(),
    managedDatabases: managedDatabases(),
  });

  assert.equal(diff.status, "manual_required");
  assert.deepEqual(
    diff.issues
      .filter((issue) => issue.code === "relation_target_mismatch")
      .map((issue) => [issue.semanticKey, issue.expectedDataSourceId, issue.actualDataSourceId]),
    [["meeting.memberRelation", "member-ds", "wrong-member-ds"]],
  );
});

test("managed schema diff treats stale mapping ids as repairable without recreating relations", () => {
  const properties = propertiesForRole("meeting");
  properties["할 일 목록"] = {
    ...properties["할 일 목록"],
    id: "remote-action-items-id",
    relation: {
      data_source_id: "task-ds",
      type: "dual_property",
      dual_property: {
        synced_property_name: "회의록",
        synced_property_id: propertyId("task.meeting"),
      },
    },
  };
  const mappings = mappingsForAllRoles().map((mapping) =>
    mapping.semanticKey === "meeting.actionItems"
      ? { ...mapping, propertyId: "stale-action-items-id" }
      : mapping,
  );

  const diff = buildManagedSchemaDiff({
    databaseRole: "meeting",
    properties,
    mappings,
    managedDatabases: managedDatabases(),
  });

  assert.equal(diff.status, "needs_repair");
  assert.deepEqual(
    diff.issues
      .filter((issue) => issue.semanticKey === "meeting.actionItems")
      .map((issue) => [issue.code, issue.severity, issue.actual]),
    [["mapping_stale", "repairable", "remote-action-items-id"]],
  );
  assert.equal(
    diff.issues.some(
      (issue) =>
        issue.semanticKey === "meeting.actionItems" &&
        issue.code === "remote_missing",
    ),
    false,
  );
});

test("managed schema diff keeps extra properties as warnings only", () => {
  const properties = {
    ...propertiesForRole("meeting"),
    Scratch: { id: "scratch-id", name: "Scratch", type: "rich_text" },
  };

  const diff = buildManagedSchemaDiff({
    databaseRole: "meeting",
    properties,
    mappings: mappingsForAllRoles(),
    managedDatabases: managedDatabases(),
  });

  assert.equal(diff.status, "healthy");
  assert.deepEqual(
    diff.issues
      .filter((issue) => issue.code === "extra")
      .map((issue) => [issue.propertyName, issue.severity]),
    [["Scratch", "warning"]],
  );
});

test("managed schema diff reports missing select options as repairable", () => {
  const properties = propertiesForRole("task");
  properties["상태"] = {
    ...properties["상태"],
    select: {
      options: [{ id: "todo-id", name: "할 일", color: "gray" }],
    },
  };

  const diff = buildManagedSchemaDiff({
    databaseRole: "task",
    properties,
    mappings: mappingsForAllRoles(),
    managedDatabases: managedDatabases(),
  });

  assert.equal(diff.status, "needs_repair");
  assert.deepEqual(
    diff.issues
      .filter((issue) => issue.code === "option_missing")
      .map((issue) => [issue.semanticKey, issue.missingOptions]),
    [["task.status", ["진행 중", "완료"]]],
  );
});

test("managed schema upload validation supports required semantic subsets", () => {
  const valid = validateManagedDataSourceSchemaForUpload({
    databaseRole: "meeting",
    properties: propertiesForRole("meeting"),
    mappings: mappingsForAllRoles(),
    managedDatabases: managedDatabases(),
    requiredSemanticKeys: ["meeting.draftId"],
  });

  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.propertyIds["meeting.draftId"]?.name, "Dirong 초안 ID");
  }

  const missingProperties = propertiesForRole("meeting");
  delete missingProperties["Dirong 초안 ID"];
  const missing = validateManagedDataSourceSchemaForUpload({
    databaseRole: "meeting",
    properties: missingProperties,
    mappings: mappingsForAllRoles(),
    managedDatabases: managedDatabases(),
    requiredSemanticKeys: ["meeting.draftId"],
  });

  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.deepEqual(missing.missing, [
      { semanticKey: "meeting.draftId", property: "Dirong 초안 ID" },
    ]);
    assert.match(missing.userAction, /DB 설정 화면/);
  }
});

test("managed schema upload validation allows stale mapping ids when relation shape is valid", () => {
  const properties = propertiesForRole("meeting");
  properties["할 일 목록"] = {
    ...properties["할 일 목록"],
    id: "remote-action-items-id",
  };
  const mappings = mappingsForAllRoles().map((mapping) =>
    mapping.semanticKey === "meeting.actionItems"
      ? { ...mapping, propertyId: "stale-action-items-id" }
      : mapping,
  );

  const validation = validateManagedDataSourceSchemaForUpload({
    databaseRole: "meeting",
    properties,
    mappings,
    managedDatabases: managedDatabases(),
    requiredSemanticKeys: ["meeting.actionItems"],
  });

  assert.equal(validation.ok, true);
  if (validation.ok) {
    assert.equal(
      validation.propertyIds["meeting.actionItems"]?.id,
      "remote-action-items-id",
    );
  }
});

function managedDatabases(): NotionManagedDatabase[] {
  return (["meeting", "member", "task"] as const).map((role) => ({
    role,
    locale: "ko",
    databaseId: `${role}-db`,
    dataSourceId: `${role}-ds`,
    url: `https://notion.so/${role}`,
    name: KOREAN_NOTION_SCHEMA_PRESET.databases[role].name,
    createdByDirong: true,
    schemaVersion: "notion-managed-db-v1",
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:00.000Z",
  }));
}

function mappingsForAllRoles(): NotionPropertyMapping[] {
  return (["meeting", "member", "task"] as const).flatMap((role) =>
    KOREAN_NOTION_SCHEMA_PRESET.databases[role].properties.map((property) =>
      mappingForProperty(role, property),
    ),
  );
}

function mappingForProperty(
  databaseRole: NotionDatabaseRole,
  property: NotionSchemaPresetProperty,
): NotionPropertyMapping {
  return {
    databaseRole,
    semanticKey: property.key,
    propertyName: property.name,
    propertyId: propertyId(property.key),
    propertyType: property.type,
    locked: property.locked,
    sourceKind: property.type === "rollup" ? "rollup" : "system",
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:00.000Z",
  };
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
    return {
      ...base,
      rollup: {
        function: "show_original",
        relation_property_id: propertyId(requiredRollup(property).relationProperty),
        relation_property_name: propertyName(requiredRollup(property).relationProperty),
        rollup_property_id: propertyId(requiredRollup(property).targetProperty),
        rollup_property_name: propertyName(requiredRollup(property).targetProperty),
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

function requiredRollup(property: NotionSchemaPresetProperty): {
  relationProperty: NotionPropertySemanticKey;
  targetProperty: NotionPropertySemanticKey;
} {
  assert.ok(property.rollup);
  return property.rollup;
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
