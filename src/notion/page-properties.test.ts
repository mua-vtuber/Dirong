import assert from "node:assert/strict";
import test from "node:test";
import { makeNotionDraftInput } from "./test-fixtures.js";
import {
  buildNotionPagePropertyValues,
  renderNotionPagePropertiesFromSemanticMappings,
  renderNotionPageProperties,
} from "./page-properties.js";
import { DEFAULT_NOTION_PROPERTY_NAMES } from "./settings.js";

test("renderNotionPageProperties maps title date time channel participants and status", () => {
  const input = makeNotionDraftInput();
  const rendered = renderNotionPageProperties({
    draftInput: input,
    propertyNames: DEFAULT_NOTION_PROPERTY_NAMES,
    contentHash: "abc123",
  });

  assert.deepEqual(rendered.properties.Name, {
    title: [{ text: { content: "주간 회의" } }],
  });
  assert.deepEqual(rendered.properties.Date, {
    date: { start: "2026-05-07" },
  });
  assert.deepEqual(rendered.properties["Meeting Time"], {
    rich_text: [{ text: { content: "19:00-20:12 (1h 12m)" } }],
  });
  assert.deepEqual(rendered.properties.Channel, {
    rich_text: [{ text: { content: "회의방" } }],
  });
  assert.deepEqual(rendered.properties.Participants, {
    multi_select: [{ name: "Taniar" }, { name: "Ari" }],
  });
  assert.deepEqual(rendered.properties.Status, {
    select: { name: "draft" },
  });
  assert.deepEqual(rendered.properties["Dirong Content Hash"], {
    rich_text: [{ text: { content: "abc123" } }],
  });
});

test("renderNotionPageProperties matches Notion status property payloads", () => {
  const input = makeNotionDraftInput();
  const rendered = renderNotionPageProperties({
    draftInput: input,
    propertyNames: DEFAULT_NOTION_PROPERTY_NAMES,
    contentHash: "abc123",
    statusPropertyType: "status",
    status: "done",
  });

  assert.deepEqual(rendered.properties.Status, {
    status: { name: "done" },
  });
});

test("renderNotionPageProperties skips Participants when it is a rollup", () => {
  const input = makeNotionDraftInput();
  const rendered = renderNotionPageProperties({
    draftInput: input,
    propertyNames: DEFAULT_NOTION_PROPERTY_NAMES,
    contentHash: "abc123",
    participantsPropertyType: "rollup",
  });

  assert.equal("Participants" in rendered.properties, false);
});

test("renderNotionPagePropertiesFromSemanticMappings uses managed property names and member relation", () => {
  const input = makeNotionDraftInput();
  const rendered = renderNotionPagePropertiesFromSemanticMappings({
    draftInput: input,
    contentHash: "abc123",
    memberRelationPageIds: ["member-1", "member-2"],
    propertiesBySemanticKey: {
      "meeting.title": { name: "회의록", type: "title" },
      "meeting.date": { name: "날짜", type: "date" },
      "meeting.time": { name: "회의 시간", type: "rich_text" },
      "meeting.channel": { name: "채널", type: "rich_text" },
      "meeting.memberRelation": { name: "참가자 연결", type: "relation" },
      "meeting.participants": { name: "참가자", type: "rollup" },
      "meeting.status": { name: "상태", type: "select" },
      "meeting.sessionId": { name: "Dirong 세션 ID", type: "rich_text" },
      "meeting.draftId": { name: "Dirong 초안 ID", type: "rich_text" },
      "meeting.contentHash": { name: "Dirong 내용 해시", type: "rich_text" },
      "meeting.localStatus": { name: "Dirong 상태", type: "rich_text" },
    },
  });

  assert.deepEqual(rendered.properties["회의록"], {
    title: [{ text: { content: "주간 회의" } }],
  });
  assert.equal("참가자" in rendered.properties, false);
  assert.deepEqual(rendered.properties["참가자 연결"], {
    relation: [{ id: "member-1" }, { id: "member-2" }],
  });
  assert.deepEqual(rendered.properties["Dirong 내용 해시"], {
    rich_text: [{ text: { content: "abc123" } }],
  });
});

test("buildNotionPagePropertyValues applies fallbacks and participant sanitization", () => {
  const input = makeNotionDraftInput({
    title: "   ",
    voiceChannelName: null,
    speakers: [
      ["Taniar, Admin", 0],
      ["taniar  admin", 0],
      ["", 0],
      ["Bot", 1],
    ],
  });

  const { values, warnings } = buildNotionPagePropertyValues({
    draftInput: input,
  });

  assert.equal(values.title, "회의록 초안");
  assert.equal(values.channel, "voice-1");
  assert.deepEqual(values.participants, ["Taniar Admin"]);
  assert.equal(warnings.length, 1);
});

test("buildNotionPagePropertyValues caps participants at 100", () => {
  const input = makeNotionDraftInput({
    speakers: Array.from({ length: 101 }, (_, index) => [
      `User ${index}`,
      0,
    ]),
  });

  const { values, warnings } = buildNotionPagePropertyValues({
    draftInput: input,
  });

  assert.equal(values.participants.length, 100);
  assert.match(warnings.join("\n"), /100명/);
});
