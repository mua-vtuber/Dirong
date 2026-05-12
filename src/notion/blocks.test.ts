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
    "할 일 목록",
    "남은 질문",
    "불확실한 내용",
    "노이즈 처리 메모",
    "타임라인",
    "Dirong 정보",
  ]);
  assert.equal(blocks[0]?.blockIndex, 0);
  assert.match(blocks.at(-1)?.plainText ?? "", /hash-final/);
});

test("renderNotionBlocks omits source markers and renders chronological transcript timeline", () => {
  const blocks = renderNotionBlocks(makeNotionDraftInput(), {
    contentHash: "hash-final",
  });
  const text = blocks.map((block) => block.plainText).join("\n");

  assert.doesNotMatch(text, /출처/);
  assert.doesNotMatch(text, /chunk-1\/stt-1/);
  assert.match(
    text,
    /\[00:00\] Taniar : 이번 주 진행 상황을 공유하겠습니다\.\n\[01:02\] Ari : Notion 업로드는 수동부터 확인하면 좋겠습니다\./,
  );
});

test("renderNotionBlocks renders empty arrays as 없음 and excludes raw provider text", () => {
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
