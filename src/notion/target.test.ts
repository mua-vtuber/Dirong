import assert from "node:assert/strict";
import test from "node:test";
import { normalizeNotionId, parseNotionTargetUrl } from "./target.js";

const dashedId = "01234567-89ab-cdef-0123-456789abcdef";
const compactId = "0123456789abcdef0123456789abcdef";
const viewId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

test("normalizeNotionId stores lowercase dashed UUIDs", () => {
  assert.equal(normalizeNotionId(compactId.toUpperCase()), dashedId);
  assert.equal(normalizeNotionId(dashedId.toUpperCase()), dashedId);
  assert.equal(normalizeNotionId("not an id"), null);
});

test("parseNotionTargetUrl treats copied IDs as data source targets", () => {
  assert.deepEqual(parseNotionTargetUrl(compactId), {
    kind: "data_source_id",
    id: dashedId,
    url: null,
  });
});

test("parseNotionTargetUrl reads data source IDs from explicit URLs", () => {
  assert.deepEqual(
    parseNotionTargetUrl(
      `https://www.notion.so/workspace/data-sources/${compactId}?v=${viewId}`,
    ),
    {
      kind: "data_source_id",
      id: dashedId,
      url: `https://www.notion.so/workspace/data-sources/${compactId}?v=${viewId}`,
    },
  );
  assert.equal(
    parseNotionTargetUrl(
      `https://www.notion.so/workspace/meetings?data_source_id=${compactId}&v=${viewId}`,
    ).kind,
    "data_source_id",
  );
});

test("parseNotionTargetUrl reads common Notion database URLs and ignores view IDs", () => {
  assert.deepEqual(
    parseNotionTargetUrl(
      `https://www.notion.so/workspace/Meetings-${compactId}?v=${viewId}&pvs=4`,
    ),
    {
      kind: "database_id",
      id: dashedId,
      url: `https://www.notion.so/workspace/Meetings-${compactId}?v=${viewId}&pvs=4`,
    },
  );
});

test("parseNotionTargetUrl rejects invalid and page-like targets", () => {
  assert.deepEqual(parseNotionTargetUrl("not a notion url"), {
    kind: "invalid",
    reason: "not_a_notion_id_or_url",
  });
  assert.deepEqual(
    parseNotionTargetUrl(`https://www.notion.so/workspace/Page-${compactId}`),
    {
      kind: "invalid",
      reason: "page_like_url_not_supported",
    },
  );
});
