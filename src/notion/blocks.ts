import type { MeetingNotesDraftV1 } from "../ai/cleanup/draft.js";
import { formatTranscriptTime } from "../transcript/time-format.js";
import { sha256Canonical } from "./content-hash.js";
import type { NotionDraftInput } from "./draft-input.js";
import { buildNotionPagePropertyValues, richText } from "./page-properties.js";

export type NotionBlockType =
  | "heading_2"
  | "paragraph"
  | "bulleted_list_item"
  | "divider";

export type NotionBlockPayload = {
  type: NotionBlockType;
  heading_2?: { rich_text: ReturnType<typeof richText> };
  paragraph?: { rich_text: ReturnType<typeof richText> };
  bulleted_list_item?: { rich_text: ReturnType<typeof richText> };
  divider?: Record<string, never>;
};

export type RenderedNotionBlock = {
  blockIndex: number;
  contentHash: string;
  plainText: string;
  type: NotionBlockType;
  block: NotionBlockPayload;
};

export type RenderNotionBlocksOptions = {
  contentHash?: string | null;
};

export function renderNotionBlocks(
  input: NotionDraftInput,
  options: RenderNotionBlocksOptions = {},
): RenderedNotionBlock[] {
  const draft = input.draftContent;
  const contentHash = options.contentHash ?? "pending";
  const rawBlocks = buildBlocks(input, draft, contentHash);

  return rawBlocks.map((block, blockIndex) => ({
    ...block,
    blockIndex,
    contentHash: sha256Canonical({
      renderer: "phase5-notion-block-v1",
      blockIndex,
      block: block.block,
    }),
  }));
}

export function chunkNotionBlocksForAppend<T>(
  blocks: readonly T[],
  maxBlocks = 100,
): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < blocks.length; index += maxBlocks) {
    chunks.push(blocks.slice(index, index + maxBlocks));
  }
  return chunks;
}

export function extractPlainTextFromBlock(block: NotionBlockPayload): string {
  if (block.type === "divider") {
    return "";
  }
  const richTextValue = block[block.type]?.rich_text ?? [];
  return richTextValue
    .map((part) => part.text.content)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

type RawRenderedBlock = Omit<RenderedNotionBlock, "blockIndex" | "contentHash">;

function buildBlocks(
  input: NotionDraftInput,
  draft: MeetingNotesDraftV1,
  contentHash: string,
): RawRenderedBlock[] {
  const blocks: RawRenderedBlock[] = [];
  const propertyValues = buildNotionPagePropertyValues({ draftInput: input }).values;

  pushSection(blocks, "회의 정보");
  pushBullets(blocks, [
    `회의 시간: ${propertyValues.meetingTime}`,
    `채널: ${propertyValues.channel}`,
    `참여자: ${propertyValues.participants.join(", ") || "없음"}`,
  ]);
  pushDivider(blocks);

  pushSection(blocks, "요약");
  pushParagraph(blocks, draft.summary.text || "없음");

  pushSection(blocks, "주요 논의");
  pushBullets(
    blocks,
    draft.topics.map(
      (topic) =>
        `${topic.title}: ${topic.summary}`,
    ),
  );

  pushSection(blocks, "결정사항");
  pushBullets(
    blocks,
    draft.decisions.map((decision) => {
      const status = decision.status === "decided" ? "확정" : "잠정";
      return `[${status}] ${decision.title}: ${decision.detail}`;
    }),
  );

  pushSection(blocks, "할 일 목록");
  pushBullets(
    blocks,
    draft.actionItems.map(
      (item) =>
        `${item.task} / 담당: ${renderOwner(item.owner)} / 기한: ${renderDueDate(
          item.dueDate,
        )}`,
    ),
  );

  pushSection(blocks, "남은 질문");
  pushBullets(
    blocks,
    draft.unresolvedItems.map(
      (item) =>
        `${item.text} / 이유: ${item.reason}`,
    ),
  );

  pushSection(blocks, "불확실한 내용");
  pushBullets(
    blocks,
    draft.uncertaintyNotes.map((note) => note.text),
  );

  pushSection(blocks, "노이즈 처리 메모");
  pushBullets(blocks, [
    `제거/압축: ${draft.noiseHandling.removedChatterSummary || "없음"}`,
    `보존 이유: ${
      draft.noiseHandling.keptBecause.length > 0
        ? draft.noiseHandling.keptBecause.join("; ")
        : "없음"
    }`,
  ]);

  pushSection(blocks, "타임라인");
  pushBullets(blocks, input.timelineEntries.map(formatTimelineEntry));

  pushSection(blocks, "Dirong 정보");
  pushBullets(blocks, [
    `Session ID: ${input.session.id}`,
    `Draft ID: ${input.draft.id}`,
    `Prompt Version: ${input.draft.prompt_version}`,
    `Provider/Model: ${input.draft.provider}/${input.draft.model}`,
    `Content Hash: ${contentHash}`,
  ]);

  return blocks;
}

function pushSection(blocks: RawRenderedBlock[], title: string): void {
  pushBlock(blocks, "heading_2", title);
}

function pushParagraph(blocks: RawRenderedBlock[], text: string): void {
  pushBlock(blocks, "paragraph", text || "없음");
}

function pushBullets(blocks: RawRenderedBlock[], items: readonly string[]): void {
  if (items.length === 0) {
    pushBlock(blocks, "bulleted_list_item", "없음");
    return;
  }
  for (const item of items) {
    pushBlock(blocks, "bulleted_list_item", item || "없음");
  }
}

function pushDivider(blocks: RawRenderedBlock[]): void {
  const block: NotionBlockPayload = { type: "divider", divider: {} };
  blocks.push({
    plainText: "",
    type: "divider",
    block,
  });
}

function pushBlock(
  blocks: RawRenderedBlock[],
  type: Exclude<NotionBlockType, "divider">,
  text: string,
): void {
  const plainText = cleanInline(text) || "없음";
  const block: NotionBlockPayload = {
    type,
    [type]: { rich_text: richText(plainText) },
  };
  blocks.push({
    plainText,
    type,
    block,
  });
}

function renderOwner(
  owner: MeetingNotesDraftV1["actionItems"][number]["owner"],
): string {
  if (owner.status === "unspecified") {
    return "미지정";
  }
  return cleanInline(owner.name ?? "") || "미지정";
}

function renderDueDate(
  dueDate: MeetingNotesDraftV1["actionItems"][number]["dueDate"],
): string {
  if (dueDate.status === "unspecified") {
    return "미지정";
  }
  return cleanInline(dueDate.rawText ?? dueDate.isoDate ?? "") || "미지정";
}

function formatTimelineEntry(
  entry: NotionDraftInput["timelineEntries"][number],
): string {
  return `[${formatTranscriptTime(entry.start_ms)}] ${cleanInline(
    entry.display_name_snapshot,
  )} : ${cleanInline(entry.text) || "내용 없음"}`;
}

function cleanInline(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
