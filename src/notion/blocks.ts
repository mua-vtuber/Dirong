import type { MeetingNotesDraftV1, TimelineReference } from "../ai/cleanup/draft.js";
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
        `${topic.title}: ${topic.summary} (${formatReferences(topic.references)})`,
    ),
  );

  pushSection(blocks, "결정사항");
  pushBullets(
    blocks,
    draft.decisions.map((decision) => {
      const status = decision.status === "decided" ? "확정" : "잠정";
      return `[${status}] ${decision.title}: ${decision.detail} (${formatReferences(
        decision.references,
      )})`;
    }),
  );

  pushSection(blocks, "액션 아이템");
  pushBullets(
    blocks,
    draft.actionItems.map(
      (item) =>
        `${item.task} / 담당: ${renderOwner(item.owner)} / 기한: ${renderDueDate(
          item.dueDate,
        )} (${formatReferences(item.references)})`,
    ),
  );

  pushSection(blocks, "남은 질문");
  pushBullets(
    blocks,
    draft.unresolvedItems.map(
      (item) =>
        `${item.text} / 이유: ${item.reason} (${formatReferences(item.references)})`,
    ),
  );

  pushSection(blocks, "불확실한 내용");
  pushBullets(
    blocks,
    draft.uncertaintyNotes.map(
      (note) => `${note.text} (${formatReferences(note.references)})`,
    ),
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

  pushSection(blocks, "근거 타임라인");
  pushBullets(blocks, collectReferences(draft).map(formatReference));

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

function collectReferences(draft: MeetingNotesDraftV1): TimelineReference[] {
  const byKey = new Map<string, TimelineReference>();
  const add = (references: readonly TimelineReference[]): void => {
    for (const reference of references) {
      byKey.set(`${reference.chunkId}\u0000${reference.sttJobId}`, reference);
    }
  };

  add(draft.meetingTitle.references);
  add(draft.summary.references);
  for (const topic of draft.topics) {
    add(topic.references);
  }
  for (const decision of draft.decisions) {
    add(decision.references);
  }
  for (const actionItem of draft.actionItems) {
    add(actionItem.references);
    add(actionItem.owner.evidence);
    add(actionItem.dueDate.evidence);
  }
  for (const item of draft.unresolvedItems) {
    add(item.references);
  }
  for (const note of draft.uncertaintyNotes) {
    add(note.references);
  }

  return [...byKey.values()].sort(
    (left, right) =>
      left.startMs - right.startMs ||
      left.endMs - right.endMs ||
      left.chunkId.localeCompare(right.chunkId) ||
      left.sttJobId.localeCompare(right.sttJobId),
  );
}

function formatReferences(references: readonly TimelineReference[]): string {
  if (references.length === 0) {
    return "출처: 없음";
  }
  return `출처: ${references.map(formatReference).join(", ")}`;
}

function formatReference(reference: TimelineReference): string {
  return `${reference.chunkId}/${reference.sttJobId} ${formatTime(
    reference.startMs,
  )}-${formatTime(reference.endMs)} ${cleanInline(reference.speaker)}`;
}

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function cleanInline(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
