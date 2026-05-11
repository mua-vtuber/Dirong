import { extractPlainTextFromBlock } from "./blocks.js";
import type { NotionBlockPayload, RenderedNotionBlock } from "./blocks.js";
import type { NotionClient } from "./client.js";
import { readId, readResults } from "./data-source-readers.js";
import { createWriterValidationError } from "./upload-result.js";
import type { NotionWriteStore } from "./write-store.js";

export async function recoverRemoteBlocks(input: {
  client: NotionClient | null;
  writeStore: NotionWriteStore;
  writeId: string;
  pageId: string;
  blocks: RenderedNotionBlock[];
  nowIso: string;
}): Promise<void> {
  if (!input.client) {
    return;
  }
  const response = await input.client.retrieveBlockChildren(input.pageId);
  const remoteBlocks = readResults(response);
  const recovered: Array<{
    blockIndex: number;
    contentHash: string;
    blockId: string | null;
  }> = [];

  for (
    let index = 0;
    index < input.blocks.length && index < remoteBlocks.length;
    index += 1
  ) {
    const planned = input.blocks[index];
    const remote = remoteBlocks[index];
    if (!planned || !remote || !blocksMatch(planned.block, remote)) {
      break;
    }
    recovered.push({
      blockIndex: planned.blockIndex,
      contentHash: planned.contentHash,
      blockId: readId(remote),
    });
  }

  if (recovered.length > 0) {
    input.writeStore.saveRecoveredBlocks({
      writeId: input.writeId,
      blocks: recovered,
      nowIso: input.nowIso,
    });
  }
}

export async function appendRemainingBlocks(input: {
  client: NotionClient | null;
  writeStore: NotionWriteStore;
  writeId: string;
  pageId: string;
  blocks: RenderedNotionBlock[];
  nowIso: string;
}): Promise<void> {
  if (!input.client) {
    throw new Error("Notion client is required.");
  }
  const appendedIndexes = new Set(
    input.writeStore
      .listBlocks(input.writeId)
      .filter((block) => block.status === "appended")
      .map((block) => block.block_index),
  );

  const remaining = input.blocks.filter(
    (block) => !appendedIndexes.has(block.blockIndex),
  );

  for (let index = 0; index < remaining.length; index += 100) {
    const batch = remaining.slice(index, index + 100);
    const response = await input.client.appendBlockChildren(input.pageId, {
      children: batch.map((block) => block.block),
    });
    const results = readResults(response);
    if (results.length !== batch.length) {
      throw createWriterValidationError(
        "Notion append response did not match the requested block count.",
        "Notion upload 상태를 확인한 뒤 다시 시도해 주세요.",
        `Notion append returned ${results.length} blocks for ${batch.length} requested blocks.`,
      );
    }

    for (let batchIndex = 0; batchIndex < batch.length; batchIndex += 1) {
      const block = batch[batchIndex];
      if (!block) {
        continue;
      }
      input.writeStore.saveBlockAppended({
        writeId: input.writeId,
        blockIndex: block.blockIndex,
        contentHash: block.contentHash,
        blockId: readId(results[batchIndex]),
        nowIso: input.nowIso,
      });
    }
  }
}

function blocksMatch(planned: NotionBlockPayload, remote: unknown): boolean {
  if (!isRecord(remote) || remote.type !== planned.type) {
    return false;
  }
  return readRemotePlainText(remote) === extractPlainTextFromBlock(planned);
}

function readRemotePlainText(remote: Record<string, unknown>): string {
  const typed = remote[remote.type as string];
  if (!isRecord(typed) || !Array.isArray(typed.rich_text)) {
    return "";
  }
  return readRichTextPlainText(typed.rich_text);
}

function readRichTextPlainText(value: unknown[]): string {
  return value
    .map((part) =>
      isRecord(part) && typeof part.plain_text === "string"
        ? part.plain_text
        : isRecord(part) &&
            isRecord(part.text) &&
            typeof part.text.content === "string"
          ? part.text.content
          : "",
    )
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
