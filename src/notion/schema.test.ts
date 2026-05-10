import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_NOTION_PROPERTY_NAMES } from "./settings.js";
import {
  validateNotionDataSourceSchema,
  validateNotionDataSourceSchemaBySemanticKey,
  type NotionDataSourceProperties,
} from "./schema.js";
import type {
  NotionPropertySemanticKey,
  NotionSchemaPresetPropertyType,
} from "./schema-presets.js";

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

test("validateNotionDataSourceSchemaBySemanticKey accepts managed Korean meeting mappings", () => {
  const validation = validateNotionDataSourceSchemaBySemanticKey({
    databaseRole: "meeting",
    properties: koreanMeetingProperties(),
    mappings: koreanMeetingMappings(),
    requiredSemanticKeys: [
      "meeting.title",
      "meeting.date",
      "meeting.time",
      "meeting.channel",
      "meeting.memberRelation",
      "meeting.participants",
      "meeting.actionItems",
      "meeting.status",
      "meeting.sessionId",
      "meeting.draftId",
      "meeting.contentHash",
      "meeting.localStatus",
    ],
  });

  assert.equal(validation.ok, true);
  if (validation.ok) {
    assert.equal(validation.propertyIds["meeting.title"]?.name, "회의록");
    assert.equal(validation.propertyIds["meeting.participants"]?.type, "rollup");
    assert.equal(validation.propertyIds["meeting.memberRelation"]?.type, "relation");
  }
});

test("validateNotionDataSourceSchemaBySemanticKey reports semantic missing and wrong type", () => {
  const properties = koreanMeetingProperties();
  delete properties["Dirong 초안 ID"];
  properties["참가자"] = { id: "participants-id", type: "multi_select" };

  const validation = validateNotionDataSourceSchemaBySemanticKey({
    databaseRole: "meeting",
    properties,
    mappings: koreanMeetingMappings(),
    requiredSemanticKeys: [
      "meeting.participants",
      "meeting.draftId",
    ],
  });

  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.deepEqual(validation.missing, [
      { semanticKey: "meeting.draftId", property: "Dirong 초안 ID" },
    ]);
    assert.deepEqual(validation.wrongType, [
      {
        semanticKey: "meeting.participants",
        property: "참가자",
        expected: "rollup",
        actual: "multi_select",
      },
    ]);
    assert.match(validation.userAction, /meeting.participants/);
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

function koreanMeetingProperties(): NotionDataSourceProperties {
  return {
    "회의록": { id: "title-id", type: "title" },
    "날짜": { id: "date-id", type: "date" },
    "회의 시간": { id: "time-id", type: "rich_text" },
    "채널": { id: "channel-id", type: "rich_text" },
    "참가자 연결": { id: "member-relation-id", type: "relation" },
    "참가자": { id: "participants-id", type: "rollup" },
    "액션 아이템": { id: "action-items-id", type: "relation" },
    "상태": { id: "status-id", type: "select" },
    "Dirong 세션 ID": { id: "session-id", type: "rich_text" },
    "Dirong 초안 ID": { id: "draft-id", type: "rich_text" },
    "Dirong 내용 해시": { id: "hash-id", type: "rich_text" },
    "Dirong 상태": { id: "local-status-id", type: "rich_text" },
  };
}

function koreanMeetingMappings() {
  return [
    semanticMapping("meeting.title", "회의록", "title"),
    semanticMapping("meeting.date", "날짜", "date"),
    semanticMapping("meeting.time", "회의 시간", "rich_text"),
    semanticMapping("meeting.channel", "채널", "rich_text"),
    semanticMapping("meeting.memberRelation", "참가자 연결", "relation"),
    semanticMapping("meeting.participants", "참가자", "rollup"),
    semanticMapping("meeting.actionItems", "액션 아이템", "relation"),
    semanticMapping("meeting.status", "상태", "select"),
    semanticMapping("meeting.sessionId", "Dirong 세션 ID", "rich_text"),
    semanticMapping("meeting.draftId", "Dirong 초안 ID", "rich_text"),
    semanticMapping("meeting.contentHash", "Dirong 내용 해시", "rich_text"),
    semanticMapping("meeting.localStatus", "Dirong 상태", "rich_text"),
  ] as const;
}

function semanticMapping(
  semanticKey: NotionPropertySemanticKey,
  propertyName: string,
  propertyType: NotionSchemaPresetPropertyType,
) {
  return {
    semanticKey,
    propertyName,
    propertyId: null,
    propertyType,
  };
}
