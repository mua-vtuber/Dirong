import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_NOTION_PROPERTY_NAMES } from "./settings.js";
import {
  buildNotionSchemaDiff,
  buildNotionSchemaUpdatePlan,
} from "./schema-manager.js";
import type { NotionCustomPropertyRule } from "./property-rules.js";
import type { NotionDataSourceProperties } from "./schema.js";

test("buildNotionSchemaDiff finds missing required and custom properties", () => {
  const diff = buildNotionSchemaDiff({
    properties: {
      Name: { id: "title-id", type: "title" },
      Date: { id: "date-id", type: "date" },
      Extra: { id: "extra-id", type: "rich_text" },
    },
    propertyNames: DEFAULT_NOTION_PROPERTY_NAMES,
    customRules: [customRule("회의 논의 사항", "rich_text")],
  });

  assert.deepEqual(
    diff.missing.map((item) => [item.propertyName, item.propertyType]),
    [
      ["Meeting Time", "rich_text"],
      ["Channel", "rich_text"],
      ["Participants", "multi_select"],
      ["Status", "select"],
      ["Session ID", "rich_text"],
      ["Draft ID", "rich_text"],
      ["Dirong Content Hash", "rich_text"],
      ["Local Status", "rich_text"],
      ["회의 논의 사항", "rich_text"],
    ],
  );
  assert.deepEqual(diff.extra.map((item) => item.propertyName), ["Extra"]);
});

test("buildNotionSchemaUpdatePlan creates missing properties and status select options", () => {
  const diff = buildNotionSchemaDiff({
    properties: {
      Name: { id: "title-id", type: "title" },
      Date: { id: "date-id", type: "date" },
    },
    propertyNames: DEFAULT_NOTION_PROPERTY_NAMES,
    customRules: [customRule("프로그래머 할 일", "rich_text")],
  });

  const plan = buildNotionSchemaUpdatePlan(diff, {
    createMissing: true,
    updateTypes: false,
    deleteExtra: false,
    confirmDeleteExtra: false,
  });

  assert.equal(plan.operations.create, 9);
  assert.deepEqual(plan.body?.properties.Status, {
    select: {
      options: [
        { name: "draft", color: "gray" },
        { name: "done", color: "green" },
        { name: "retry_wait", color: "yellow" },
        { name: "failed", color: "red" },
      ],
    },
  });
  assert.deepEqual(plan.body?.properties["프로그래머 할 일"], { rich_text: {} });
});

test("buildNotionSchemaUpdatePlan preserves existing select options when adding status values", () => {
  const diff = buildNotionSchemaDiff({
    properties: {
      ...completeProperties(),
      Status: {
        id: "status-id",
        type: "select",
        select: {
          options: [{ id: "existing-id", name: "archived", color: "blue" }],
        },
      },
    },
    propertyNames: DEFAULT_NOTION_PROPERTY_NAMES,
    customRules: [],
  });

  const plan = buildNotionSchemaUpdatePlan(diff, {
    createMissing: true,
    updateTypes: false,
    deleteExtra: false,
    confirmDeleteExtra: false,
  });

  assert.deepEqual(plan.body?.properties["status-id"], {
    select: {
      options: [
        { id: "existing-id" },
        { name: "draft", color: "gray" },
        { name: "done", color: "green" },
        { name: "retry_wait", color: "yellow" },
        { name: "failed", color: "red" },
      ],
    },
  });
});

test("buildNotionSchemaUpdatePlan preserves existing select option names and colors without ids", () => {
  const diff = buildNotionSchemaDiff({
    properties: {
      ...completeProperties(),
      Status: {
        id: "status-id",
        type: "select",
        select: {
          options: [{ name: "archived", color: "blue" }],
        },
      },
    },
    propertyNames: DEFAULT_NOTION_PROPERTY_NAMES,
    customRules: [],
  });

  const plan = buildNotionSchemaUpdatePlan(diff, {
    createMissing: true,
    updateTypes: false,
    deleteExtra: false,
    confirmDeleteExtra: false,
  });

  assert.deepEqual(plan.body?.properties["status-id"], {
    select: {
      options: [
        { name: "archived", color: "blue" },
        { name: "draft", color: "gray" },
        { name: "done", color: "green" },
        { name: "retry_wait", color: "yellow" },
        { name: "failed", color: "red" },
      ],
    },
  });
});

test("buildNotionSchemaDiff accepts Participants rollup properties", () => {
  const diff = buildNotionSchemaDiff({
    properties: {
      ...completeProperties(),
      Participants: { id: "participants-id", type: "rollup" },
    },
    propertyNames: DEFAULT_NOTION_PROPERTY_NAMES,
    customRules: [],
  });

  assert.equal(diff.isCompatible, true);
  assert.equal(
    diff.wrongType.some((item) => item.propertyName === "Participants"),
    false,
  );
});

test("buildNotionSchemaUpdatePlan requires explicit confirmation before deleting extras", () => {
  const diff = buildNotionSchemaDiff({
    properties: {
      ...completeProperties(),
      Scratch: { id: "scratch-id", type: "rich_text" },
    },
    propertyNames: DEFAULT_NOTION_PROPERTY_NAMES,
    customRules: [],
  });

  const blockedDelete = buildNotionSchemaUpdatePlan(diff, {
    createMissing: true,
    updateTypes: false,
    deleteExtra: true,
    confirmDeleteExtra: false,
  });
  assert.equal(blockedDelete.operations.delete, 0);
  assert.equal(blockedDelete.body, null);
  assert.match(blockedDelete.warnings.join(" "), /확인/);

  const confirmedDelete = buildNotionSchemaUpdatePlan(diff, {
    createMissing: true,
    updateTypes: false,
    deleteExtra: true,
    confirmDeleteExtra: true,
  });
  assert.equal(confirmedDelete.operations.delete, 1);
  assert.deepEqual(confirmedDelete.body?.properties["scratch-id"], null);
});

test("buildNotionSchemaUpdatePlan renames existing title property instead of creating one", () => {
  const diff = buildNotionSchemaDiff({
    properties: completeProperties(),
    propertyNames: {
      ...DEFAULT_NOTION_PROPERTY_NAMES,
      title: "회의록",
    },
    customRules: [],
  });

  const plan = buildNotionSchemaUpdatePlan(diff, {
    createMissing: true,
    updateTypes: false,
    deleteExtra: false,
    confirmDeleteExtra: false,
  });

  assert.deepEqual(plan.body?.properties["title-id"], { name: "회의록" });
  assert.equal(plan.operations.rename, 1);
  assert.equal(
    Object.values(plan.body?.properties ?? {}).some(
      (value) => isRecord(value) && "title" in value,
    ),
    false,
  );
});

test("buildNotionSchemaUpdatePlan creates relation properties with target data source", () => {
  const diff = buildNotionSchemaDiff({
    properties: completeProperties(),
    propertyNames: DEFAULT_NOTION_PROPERTY_NAMES,
    customRules: [
      {
        ...customRule("프로젝트", "relation"),
        relationDataSourceId: "668d797c-76fa-4934-9b05-ad288df2d136",
        relationTargetUrl: "https://www.notion.so/projects",
        relationTargetPageUrl: null,
        relationTargetPageId: null,
        relationAutoCreate: true,
      },
    ],
  });

  const plan = buildNotionSchemaUpdatePlan(diff, {
    createMissing: true,
    updateTypes: false,
    deleteExtra: false,
    confirmDeleteExtra: false,
  });

  assert.deepEqual(plan.body?.properties["프로젝트"], {
    relation: {
      data_source_id: "668d797c-76fa-4934-9b05-ad288df2d136",
    },
  });
});

function completeProperties(): NotionDataSourceProperties {
  return {
    Name: { id: "title-id", type: "title" },
    Date: { id: "date-id", type: "date" },
    "Meeting Time": { id: "meeting-time-id", type: "rich_text" },
    Channel: { id: "channel-id", type: "rich_text" },
    Participants: { id: "participants-id", type: "multi_select" },
    Status: {
      id: "status-id",
      type: "select",
      select: {
        options: [
          { id: "draft-id", name: "draft", color: "gray" },
          { id: "done-id", name: "done", color: "green" },
          { id: "retry-id", name: "retry_wait", color: "yellow" },
          { id: "failed-id", name: "failed", color: "red" },
        ],
      },
    },
    "Session ID": { id: "session-id", type: "rich_text" },
    "Draft ID": { id: "draft-id", type: "rich_text" },
    "Dirong Content Hash": { id: "content-hash-id", type: "rich_text" },
    "Local Status": { id: "local-status-id", type: "rich_text" },
  };
}

function customRule(
  propertyName: string,
  propertyType: NotionCustomPropertyRule["propertyType"],
): NotionCustomPropertyRule {
  return {
    propertyName,
    propertyId: null,
    propertyType,
    valueSource: "ai",
    enabled: true,
    promptDescription: "회의 내용에서 값을 채웁니다.",
    maxLength: 1000,
    relationTargetUrl: null,
    relationDataSourceId: null,
    relationTargetPageUrl: null,
    relationTargetPageId: null,
    relationMatchPropertyName: "Name",
    relationAutoCreate: false,
    lastSeenAt: null,
    createdAt: "2026-05-08T00:00:00.000Z",
    updatedAt: "2026-05-08T00:00:00.000Z",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
