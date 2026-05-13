import type { MeetingNotesDraftV1 } from "../ai/cleanup/draft.js";
import {
  DEFAULT_DIRONG_LOCALE,
  isDirongLocale,
  type DirongLocale,
} from "../settings/local-settings-store.js";
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
  locale?: DirongLocale;
};

export function renderNotionBlocks(
  input: NotionDraftInput,
  options: RenderNotionBlocksOptions = {},
): RenderedNotionBlock[] {
  const draft = input.draftContent;
  const text = notionBlockText(options.locale ?? draft.language);
  const contentHash = options.contentHash ?? "pending";
  const rawBlocks = buildBlocks(input, draft, contentHash, text);

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
  text: NotionBlockText,
): RawRenderedBlock[] {
  const blocks: RawRenderedBlock[] = [];
  const propertyValues = buildNotionPagePropertyValues({ draftInput: input }).values;

  pushSection(blocks, text.meetingInfoHeading, text);
  pushBullets(blocks, [
    `${text.meetingTimeLabel}: ${propertyValues.meetingTime}`,
    `${text.channelLabel}: ${propertyValues.channel}`,
    `${text.participantsLabel}: ${propertyValues.participants.join(", ") || text.empty}`,
  ], text);
  pushDivider(blocks);

  pushSection(blocks, text.summaryHeading, text);
  pushParagraph(blocks, draft.summary.text || text.empty, text);

  pushSection(blocks, text.topicsHeading, text);
  pushBullets(
    blocks,
    draft.topics.map(
      (topic) =>
        `${topic.title}: ${topic.summary}`,
    ),
    text,
  );

  pushSection(blocks, text.decisionsHeading, text);
  pushBullets(
    blocks,
    draft.decisions.map((decision) => {
      const status = decision.status === "decided" ? text.decided : text.tentative;
      return `[${status}] ${decision.title}: ${decision.detail}`;
    }),
    text,
  );

  pushSection(blocks, text.actionItemsHeading, text);
  pushBullets(
    blocks,
    draft.actionItems.map(
      (item) =>
        `${item.task} / ${text.ownerLabel}: ${renderOwner(item.owner, text)} / ${text.dueLabel}: ${renderDueDate(
          item.dueDate,
          text,
        )}`,
    ),
    text,
  );

  pushSection(blocks, text.unresolvedHeading, text);
  pushBullets(
    blocks,
    draft.unresolvedItems.map(
      (item) =>
        `${item.text} / ${text.reasonLabel}: ${item.reason}`,
    ),
    text,
  );

  pushSection(blocks, text.uncertaintyHeading, text);
  pushBullets(
    blocks,
    draft.uncertaintyNotes.map((note) => note.text),
    text,
  );

  pushSection(blocks, text.noiseHeading, text);
  pushBullets(blocks, [
    `${text.removedChatterLabel}: ${draft.noiseHandling.removedChatterSummary || text.empty}`,
    `${text.keptBecauseLabel}: ${
      draft.noiseHandling.keptBecause.length > 0
        ? draft.noiseHandling.keptBecause.join("; ")
        : text.empty
    }`,
  ], text);

  pushSection(blocks, text.timelineHeading, text);
  pushBullets(
    blocks,
    input.timelineEntries.map((entry) => formatTimelineEntry(entry, text)),
    text,
  );

  pushSection(blocks, text.dirongInfoHeading, text);
  pushBullets(blocks, [
    `Session ID: ${input.session.id}`,
    `Draft ID: ${input.draft.id}`,
    `Prompt Version: ${input.draft.prompt_version}`,
    `Provider/Model: ${input.draft.provider}/${input.draft.model}`,
    `Content Hash: ${contentHash}`,
  ], text);

  return blocks;
}

type NotionBlockText = {
  meetingInfoHeading: string;
  meetingTimeLabel: string;
  channelLabel: string;
  participantsLabel: string;
  summaryHeading: string;
  topicsHeading: string;
  decisionsHeading: string;
  actionItemsHeading: string;
  unresolvedHeading: string;
  uncertaintyHeading: string;
  noiseHeading: string;
  timelineHeading: string;
  dirongInfoHeading: string;
  empty: string;
  decided: string;
  tentative: string;
  ownerLabel: string;
  dueLabel: string;
  reasonLabel: string;
  removedChatterLabel: string;
  keptBecauseLabel: string;
  unspecified: string;
  noContent: string;
};

const NOTION_BLOCK_TEXT: Record<DirongLocale, NotionBlockText> = {
  ko: {
    meetingInfoHeading: "회의 정보",
    meetingTimeLabel: "회의 시간",
    channelLabel: "채널",
    participantsLabel: "참여자",
    summaryHeading: "요약",
    topicsHeading: "주요 논의",
    decisionsHeading: "결정사항",
    actionItemsHeading: "할 일 목록",
    unresolvedHeading: "남은 질문",
    uncertaintyHeading: "불확실한 내용",
    noiseHeading: "노이즈 처리 메모",
    timelineHeading: "타임라인",
    dirongInfoHeading: "Dirong 정보",
    empty: "없음",
    decided: "확정",
    tentative: "잠정",
    ownerLabel: "담당",
    dueLabel: "기한",
    reasonLabel: "이유",
    removedChatterLabel: "제거/압축",
    keptBecauseLabel: "보존 이유",
    unspecified: "미지정",
    noContent: "내용 없음",
  },
  en: {
    meetingInfoHeading: "Meeting Info",
    meetingTimeLabel: "Meeting time",
    channelLabel: "Channel",
    participantsLabel: "Participants",
    summaryHeading: "Summary",
    topicsHeading: "Key Discussion",
    decisionsHeading: "Decisions",
    actionItemsHeading: "Action Items",
    unresolvedHeading: "Open Questions",
    uncertaintyHeading: "Uncertain Content",
    noiseHeading: "Noise Handling Notes",
    timelineHeading: "Timeline",
    dirongInfoHeading: "Dirong Info",
    empty: "None",
    decided: "Decided",
    tentative: "Tentative",
    ownerLabel: "Owner",
    dueLabel: "Due",
    reasonLabel: "reason",
    removedChatterLabel: "Removed/compressed",
    keptBecauseLabel: "Kept because",
    unspecified: "Unspecified",
    noContent: "No content",
  },
};

function notionBlockText(locale: unknown): NotionBlockText {
  return NOTION_BLOCK_TEXT[
    isDirongLocale(locale) ? locale : DEFAULT_DIRONG_LOCALE
  ];
}

function pushSection(
  blocks: RawRenderedBlock[],
  title: string,
  text: NotionBlockText,
): void {
  pushBlock(blocks, "heading_2", title, text);
}

function pushParagraph(
  blocks: RawRenderedBlock[],
  value: string,
  text: NotionBlockText,
): void {
  pushBlock(blocks, "paragraph", value || text.empty, text);
}

function pushBullets(
  blocks: RawRenderedBlock[],
  items: readonly string[],
  text: NotionBlockText,
): void {
  if (items.length === 0) {
    pushBlock(blocks, "bulleted_list_item", text.empty, text);
    return;
  }
  for (const item of items) {
    pushBlock(blocks, "bulleted_list_item", item || text.empty, text);
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
  labels: NotionBlockText,
): void {
  const plainText = cleanInline(text) || labels.empty;
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
  text: NotionBlockText,
): string {
  if (owner.status === "unspecified") {
    return text.unspecified;
  }
  return cleanInline(owner.name ?? "") || text.unspecified;
}

function renderDueDate(
  dueDate: MeetingNotesDraftV1["actionItems"][number]["dueDate"],
  text: NotionBlockText,
): string {
  if (dueDate.status === "unspecified") {
    return text.unspecified;
  }
  return cleanInline(dueDate.rawText ?? dueDate.isoDate ?? "") || text.unspecified;
}

function formatTimelineEntry(
  entry: NotionDraftInput["timelineEntries"][number],
  text: NotionBlockText,
): string {
  return `[${formatTranscriptTime(entry.start_ms)}] ${cleanInline(
    entry.display_name_snapshot,
  )} : ${cleanInline(entry.text) || text.noContent}`;
}

function cleanInline(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
