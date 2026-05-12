import assert from "node:assert/strict";
import test from "node:test";
import {
  KOREAN_NOTION_SCHEMA_PRESET,
  NOTION_PROPERTY_SEMANTIC_KEYS,
  NOTION_TASK_STATUS_OPTIONS,
  validateNotionSchemaPreset,
  type NotionPropertySemanticKey,
  type NotionSchemaPreset,
  type NotionSchemaPresetProperty,
} from "./schema-presets.js";

const KOREAN_PRESET: NotionSchemaPreset = KOREAN_NOTION_SCHEMA_PRESET;

test("Korean Notion schema preset contains every required semantic key", () => {
  const validation = validateNotionSchemaPreset(KOREAN_PRESET);

  assert.equal(validation.ok, true);

  const keys = new Set(
    Object.values(KOREAN_PRESET.databases).flatMap((database) =>
      database.properties.map((property) => property.key),
    ),
  );
  assert.deepEqual([...keys].sort(), [...NOTION_PROPERTY_SEMANTIC_KEYS].sort());
});

test("Korean Notion schema preset defines the managed DB names and relation shape", () => {
  assert.equal(KOREAN_PRESET.databases.meeting.name, "회의록");
  assert.equal(KOREAN_PRESET.databases.member.name, "작업자");
  assert.equal(KOREAN_PRESET.databases.task.name, "할 일 목록");

  assert.deepEqual(findProperty("meeting.memberRelation").relation, {
    mode: "direct",
    targetDatabase: "member",
  });
  assert.deepEqual(findProperty("meeting.actionItems").relation, {
    mode: "synced",
    targetDatabase: "task",
    sourceProperty: "task.meeting",
  });
  assert.deepEqual(findProperty("task.meeting").relation, {
    mode: "direct",
    targetDatabase: "meeting",
  });
});

test("Korean Notion schema preset defines rollup targets logically", () => {
  assert.deepEqual(findProperty("meeting.participants").rollup, {
    relationProperty: "meeting.memberRelation",
    targetProperty: "member.notionPerson",
  });
  assert.deepEqual(findProperty("task.assignee").rollup, {
    relationProperty: "task.workerRelation",
    targetProperty: "member.notionPerson",
  });
  assert.deepEqual(findProperty("task.role").rollup, {
    relationProperty: "task.workerRelation",
    targetProperty: "member.roles",
  });
});

test("Korean Notion schema preset locks task status options to the MVP values", () => {
  assert.deepEqual(findProperty("task.status").options, NOTION_TASK_STATUS_OPTIONS);
});

test("validateNotionSchemaPreset rejects duplicate names inside one DB", () => {
  const preset = clonePreset();
  preset.databases.meeting.properties = [
    ...preset.databases.meeting.properties,
    {
      key: "meeting.channel",
      name: "회의록",
      type: "rich_text",
      locked: true,
    },
  ];

  const validation = validateNotionSchemaPreset(preset);

  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.equal(
      validation.errors.some((error) => error.code === "duplicate_property_name"),
      true,
    );
  }
});

test("validateNotionSchemaPreset rejects invalid rollup targets", () => {
  const preset = clonePreset();
  const assignee = preset.databases.task.properties.find(
    (property) => property.key === "task.assignee",
  );
  assert.ok(assignee);
  assignee.rollup = {
    relationProperty: "task.workerRelation",
    targetProperty: "meeting.title",
  };

  const validation = validateNotionSchemaPreset(preset);

  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.equal(
      validation.errors.some((error) => error.code === "invalid_rollup_target"),
      true,
    );
  }
});

test("validateNotionSchemaPreset rejects invalid synced relation targets", () => {
  const preset = clonePreset();
  const actionItems = preset.databases.meeting.properties.find(
    (property) => property.key === "meeting.actionItems",
  );
  assert.ok(actionItems);
  actionItems.relation = {
    mode: "synced",
    targetDatabase: "task",
    sourceProperty: "task.workerRelation",
  };

  const validation = validateNotionSchemaPreset(preset);

  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.equal(
      validation.errors.some((error) => error.code === "invalid_synced_relation"),
      true,
    );
  }
});

test("validateNotionSchemaPreset rejects changed task status options", () => {
  const preset = clonePreset();
  const status = preset.databases.task.properties.find(
    (property) => property.key === "task.status",
  );
  assert.ok(status);
  status.options = ["할 일", "완료"];

  const validation = validateNotionSchemaPreset(preset);

  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.equal(
      validation.errors.some(
        (error) => error.code === "invalid_task_status_options",
      ),
      true,
    );
  }
});

function findProperty(
  key: NotionPropertySemanticKey,
): NotionSchemaPresetProperty {
  const property = Object.values(KOREAN_PRESET.databases)
    .flatMap((database) => database.properties)
    .find((item) => item.key === key);
  assert.ok(property);
  return property;
}

function clonePreset(): NotionSchemaPreset {
  return JSON.parse(JSON.stringify(KOREAN_NOTION_SCHEMA_PRESET)) as NotionSchemaPreset;
}
