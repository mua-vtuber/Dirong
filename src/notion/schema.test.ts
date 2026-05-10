import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_NOTION_PROPERTY_NAMES } from "./settings.js";
import {
  validateNotionDataSourceSchema,
  type NotionDataSourceProperties,
} from "./schema.js";

test("validateNotionDataSourceSchema accepts required MVP properties", () => {
  const validation = validateNotionDataSourceSchema(
    completeProperties(),
    DEFAULT_NOTION_PROPERTY_NAMES,
  );

  assert.equal(validation.ok, true);
  if (validation.ok) {
    assert.equal(validation.propertyIds.title.id, "title-id");
    assert.equal(validation.propertyIds.status.type, "select");
  }
});

test("validateNotionDataSourceSchema accepts Notion status property type", () => {
  const properties = completeProperties();
  properties.Status = {
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
  };

  const validation = validateNotionDataSourceSchema(
    properties,
    DEFAULT_NOTION_PROPERTY_NAMES,
  );

  assert.equal(validation.ok, true);
});

test("validateNotionDataSourceSchema accepts Participants as a rollup", () => {
  const properties = completeProperties();
  properties.Participants = {
    id: "participants-id",
    type: "rollup",
  };

  const validation = validateNotionDataSourceSchema(
    properties,
    DEFAULT_NOTION_PROPERTY_NAMES,
  );

  assert.equal(validation.ok, true);
  if (validation.ok) {
    assert.equal(validation.propertyIds.participants.type, "rollup");
  }
});

test("validateNotionDataSourceSchema blocks status properties missing upload options", () => {
  const properties = completeProperties();
  properties.Status = {
    id: "status-id",
    type: "status",
    status: {
      options: [{ id: "draft-id", name: "draft" }],
    },
  };

  const validation = validateNotionDataSourceSchema(
    properties,
    DEFAULT_NOTION_PROPERTY_NAMES,
  );

  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.deepEqual(validation.wrongType, [
      {
        property: "Status",
        expected: "status options: draft, done, retry_wait, failed",
        actual: "missing options: done, retry_wait, failed",
      },
    ]);
    assert.match(validation.userAction, /Status/);
  }
});

test("validateNotionDataSourceSchema reports missing and wrong properties with Korean action", () => {
  const properties = completeProperties();
  delete properties["Draft ID"];
  properties.Participants = { id: "participants-id", type: "rich_text" };

  const validation = validateNotionDataSourceSchema(
    properties,
    DEFAULT_NOTION_PROPERTY_NAMES,
  );

  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.deepEqual(validation.missing, ["Draft ID"]);
    assert.deepEqual(validation.wrongType, [
      {
        property: "Participants",
        expected: "multi_select or rollup",
        actual: "rich_text",
      },
    ]);
    assert.match(validation.userAction, /Notion 데이터베이스/);
    assert.match(validation.userAction, /연결 테스트/);
  }
});

function completeProperties(): NotionDataSourceProperties {
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
