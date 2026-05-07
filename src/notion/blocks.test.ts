import assert from "node:assert/strict";
import test from "node:test";
import { renderNotionBlocks } from "./blocks.js";
import { makeNotionDraftInput } from "./test-fixtures.js";

test("renderNotionBlocks renders deterministic MVP sections", () => {
  const blocks = renderNotionBlocks(makeNotionDraftInput(), {
    contentHash: "hash-final",
  });

  const headings = blocks
    .filter((block) => block.type === "heading_2")
    .map((block) => block.plainText);

  assert.deepEqual(headings, [
    "회의 정보",
    "요약",
    "주요 논의",
    "결정사항",
    "액션 아이템",
    "남은 질문",
    "불확실한 내용",
    "노이즈 처리 메모",
    "근거 타임라인",
    "Dirong 정보",
  ]);
  assert.equal(blocks[0]?.blockIndex, 0);
  assert.match(blocks.at(-1)?.plainText ?? "", /hash-final/);
});

test("renderNotionBlocks renders empty arrays as 없음 and excludes raw transcript", () => {
  const blocks = renderNotionBlocks(
    makeNotionDraftInput({
      emptyDraftArrays: true,
    }),
  );
  const text = blocks.map((block) => block.plainText).join("\n");

  assert.match(text, /주요 논의\n없음/);
  assert.doesNotMatch(text, /raw transcript/i);
});

test("renderNotionBlocks splits rich text before Notion text limits", () => {
  const longText = "가".repeat(2001);
  const blocks = renderNotionBlocks(makeNotionDraftInput({ summary: longText }));
  const summaryBlock = blocks.find((block) => block.plainText === longText);

  assert.equal(summaryBlock?.block.type, "paragraph");
  assert.equal(summaryBlock?.block.paragraph?.rich_text.length, 2);
  assert.equal(
    summaryBlock?.block.paragraph?.rich_text[0]?.text.content.length,
    2000,
  );
  assert.equal(summaryBlock?.block.paragraph?.rich_text[1]?.text.content, "가");
});
