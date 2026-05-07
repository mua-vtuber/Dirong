import assert from "node:assert/strict";
import test from "node:test";
import { renderNotionBlocks } from "./blocks.js";
import { computeNotionContentHash } from "./content-hash.js";
import { makeNotionDraftInput } from "./test-fixtures.js";
import { buildNotionPagePropertyValues } from "./page-properties.js";

test("computeNotionContentHash is stable for canonical key ordering", () => {
  const input = makeNotionDraftInput();
  const propertyValues = buildNotionPagePropertyValues({ draftInput: input }).values;
  const blocks = renderNotionBlocks(input).map((block) => block.block);

  const first = computeNotionContentHash({
    draftId: input.draft.id,
    draftOutputHash: input.draft.output_hash,
    sessionId: input.session.id,
    targetDataSourceId: "target-1",
    propertyValues,
    renderedBlocks: blocks,
  });
  const second = computeNotionContentHash({
    renderedBlocks: blocks,
    propertyValues,
    targetDataSourceId: "target-1",
    sessionId: input.session.id,
    draftOutputHash: input.draft.output_hash,
    draftId: input.draft.id,
  });

  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
});

test("computeNotionContentHash changes when rendered content changes", () => {
  const firstInput = makeNotionDraftInput();
  const secondInput = makeNotionDraftInput({ summary: "다른 요약" });

  const first = hashForInput(firstInput);
  const second = hashForInput(secondInput);

  assert.notEqual(first, second);
});

function hashForInput(input: ReturnType<typeof makeNotionDraftInput>): string {
  return computeNotionContentHash({
    draftId: input.draft.id,
    draftOutputHash: input.draft.output_hash,
    sessionId: input.session.id,
    targetDataSourceId: "target-1",
    propertyValues: buildNotionPagePropertyValues({ draftInput: input }).values,
    renderedBlocks: renderNotionBlocks(input).map((block) => block.block),
  });
}
