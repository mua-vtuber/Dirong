import assert from "node:assert/strict";
import test from "node:test";
import {
  readDataSourceProperties,
  readDataSourcePropertyMap,
  readFirstDataSourceId,
  readId,
  readRichTextPlainText,
  readResults,
  readTargetName,
} from "./data-source-readers.js";

test("Notion data source readers preserve lenient writer property reads", () => {
  assert.deepEqual(readDataSourceProperties({}), {});
  assert.deepEqual(readDataSourceProperties({ properties: null }), {});
  assert.deepEqual(
    readDataSourceProperties({ properties: { Name: { type: "title" } } }),
    { Name: { type: "title" } },
  );
});

test("Notion data source property map uses Notion names and rejects missing properties", () => {
  const properties = readDataSourcePropertyMap({
    properties: {
      fallback: { id: "prop-id", name: "Display", type: "rich_text" },
      unnamed: { id: "unnamed-id", type: "title" },
      ignored: "not an object",
    },
  });

  assert.deepEqual([...properties.keys()], ["Display", "unnamed"]);
  assert.equal(properties.get("Display")?.id, "prop-id");
  assert.throws(() => readDataSourcePropertyMap({}), /properties/);
});

test("Notion response id readers handle database children and result lists", () => {
  assert.equal(
    readFirstDataSourceId({ data_sources: [{ id: "ds-1" }, { id: "ds-2" }] }),
    "ds-1",
  );
  assert.equal(readFirstDataSourceId({ data_sources: [{ missing: true }] }), null);
  assert.equal(readId({ id: "page-1" }), "page-1");
  assert.deepEqual(readResults({ results: [{ id: "a" }, { id: "b" }] }), [
    { id: "a" },
    { id: "b" },
  ]);
  assert.deepEqual(readResults({}), []);
});

test("Notion rich text readers prefer plain text and normalize fallback content", () => {
  assert.equal(
    readRichTextPlainText([
      { plain_text: " hello\n" },
      { text: { content: "world" } },
      { text: { content: "   again" } },
      { text: { ignored: true } },
      null,
    ]),
    "hello world again",
  );
});

test("Notion target names prefer data source name, then title, then fallback", () => {
  assert.equal(
    readTargetName({ name: "  회의록 DB  ", title: [{ plain_text: "ignored" }] }),
    "회의록 DB",
  );
  assert.equal(
    readTargetName({ title: [{ text: { content: "회의\n자료" } }] }),
    "회의 자료",
  );
  assert.equal(readTargetName({}, "fallback"), "fallback");
});
