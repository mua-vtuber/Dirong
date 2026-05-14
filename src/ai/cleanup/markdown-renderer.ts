import type { MeetingNotesDraftV1, TimelineReference } from "./draft.js";
import { timelineReferenceKey } from "./draft/reference-index.js";
import {
  DEFAULT_DIRONG_LOCALE,
  isDirongLocale,
  type DirongLocale,
} from "../../settings/local-settings-store.js";

export type MeetingNotesMarkdownRenderOptions = {
  maxLineLength?: number;
  locale?: DirongLocale;
};

const DEFAULT_MAX_LINE_LENGTH = 100;
const MIN_LINE_LENGTH = 48;

export function renderMeetingNotesDraftMarkdown(
  draft: MeetingNotesDraftV1,
  options: MeetingNotesMarkdownRenderOptions = {},
): string {
  const text = markdownText(options.locale ?? draft.language);
  const maxLineLength = Math.max(
    MIN_LINE_LENGTH,
    options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH,
  );
  const lines: string[] = [];

  lines.push(`# ${cleanInline(draft.meetingTitle.text) || text.draftTitle}`, "");
  appendSummary(lines, draft, maxLineLength, text);
  appendTopics(lines, draft, maxLineLength, text);
  appendDecisions(lines, draft, maxLineLength, text);
  appendActionItems(lines, draft, maxLineLength, text);
  appendUnresolved(lines, draft, maxLineLength, text);
  appendNoiseHandling(lines, draft, maxLineLength, text);
  appendSourceTimeline(lines, draft, text);

  return trimTrailingBlankLines(lines).join("\n");
}

type MarkdownText = {
  draftTitle: string;
  summaryHeading: string;
  topicsHeading: string;
  decisionsHeading: string;
  actionItemsHeading: string;
  unresolvedHeading: string;
  noiseHeading: string;
  sourceTimelineHeading: string;
  empty: string;
  decided: string;
  tentative: string;
  ownerLabel: string;
  dueLabel: string;
  unspecified: string;
  unresolvedLabel: string;
  uncertainLabel: string;
  reasonLabel: string;
  removedChatterPrefix: string;
  keptBecausePrefix: string;
  keptBecauseHeading: string;
  sourceLabel: string;
};

const MARKDOWN_TEXT: Record<DirongLocale, MarkdownText> = {
  ko: {
    draftTitle: "회의록 초안",
    summaryHeading: "요약",
    topicsHeading: "주요 주제",
    decisionsHeading: "결정 사항",
    actionItemsHeading: "할 일 목록",
    unresolvedHeading: "미해결/불확실한 항목",
    noiseHeading: "잡담/노이즈 처리",
    sourceTimelineHeading: "출처 타임라인",
    empty: "없음",
    decided: "확정",
    tentative: "잠정",
    ownerLabel: "담당",
    dueLabel: "기한",
    unspecified: "미지정",
    unresolvedLabel: "미해결",
    uncertainLabel: "불확실",
    reasonLabel: "이유",
    removedChatterPrefix: "제거/압축: ",
    keptBecausePrefix: "보존 이유: ",
    keptBecauseHeading: "보존 이유:",
    sourceLabel: "출처",
  },
  en: {
    draftTitle: "Meeting notes draft",
    summaryHeading: "Summary",
    topicsHeading: "Key Topics",
    decisionsHeading: "Decisions",
    actionItemsHeading: "Action Items",
    unresolvedHeading: "Unresolved / Uncertain Items",
    noiseHeading: "Chatter / Noise Handling",
    sourceTimelineHeading: "Source Timeline",
    empty: "None",
    decided: "Decided",
    tentative: "Tentative",
    ownerLabel: "Owner",
    dueLabel: "Due",
    unspecified: "Unspecified",
    unresolvedLabel: "Unresolved",
    uncertainLabel: "Uncertain",
    reasonLabel: "reason",
    removedChatterPrefix: "Removed/compressed: ",
    keptBecausePrefix: "Kept because: ",
    keptBecauseHeading: "Kept because:",
    sourceLabel: "Source",
  },
};

function markdownText(locale: unknown): MarkdownText {
  return MARKDOWN_TEXT[isDirongLocale(locale) ? locale : DEFAULT_DIRONG_LOCALE];
}

function appendSummary(
  lines: string[],
  draft: MeetingNotesDraftV1,
  maxLineLength: number,
  text: MarkdownText,
): void {
  appendHeading(lines, text.summaryHeading);
  appendParagraph(lines, draft.summary.text, maxLineLength, text);
  appendReferenceLine(lines, draft.summary.references, maxLineLength, text);
  lines.push("");
}

function appendTopics(
  lines: string[],
  draft: MeetingNotesDraftV1,
  maxLineLength: number,
  text: MarkdownText,
): void {
  appendHeading(lines, text.topicsHeading);
  if (draft.topics.length === 0) {
    appendEmpty(lines, text);
  } else {
    for (const topic of draft.topics) {
      appendWrappedLine(
        lines,
        `**${cleanInline(topic.title)}**: ${cleanInline(topic.summary)}`,
        "- ",
        "  ",
        maxLineLength,
        text,
      );
      appendReferenceLine(lines, topic.references, maxLineLength, text, "  ");
    }
  }
  lines.push("");
}

function appendDecisions(
  lines: string[],
  draft: MeetingNotesDraftV1,
  maxLineLength: number,
  text: MarkdownText,
): void {
  appendHeading(lines, text.decisionsHeading);
  if (draft.decisions.length === 0) {
    appendEmpty(lines, text);
  } else {
    for (const decision of draft.decisions) {
      const status = decision.status === "decided" ? text.decided : text.tentative;
      appendWrappedLine(
        lines,
        `[${status}] ${cleanInline(decision.title)}: ${cleanInline(decision.detail)}`,
        "- ",
        "  ",
        maxLineLength,
        text,
      );
      appendReferenceLine(lines, decision.references, maxLineLength, text, "  ");
    }
  }
  lines.push("");
}

function appendActionItems(
  lines: string[],
  draft: MeetingNotesDraftV1,
  maxLineLength: number,
  text: MarkdownText,
): void {
  appendHeading(lines, text.actionItemsHeading);
  if (draft.actionItems.length === 0) {
    appendEmpty(lines, text);
  } else {
    for (const actionItem of draft.actionItems) {
      appendWrappedLine(
        lines,
        cleanInline(actionItem.task),
        "- ",
        "  ",
        maxLineLength,
        text,
      );
      appendWrappedLine(
        lines,
        `${text.ownerLabel}: ${renderOwner(actionItem.owner, text)}`,
        "  ",
        "  ",
        maxLineLength,
        text,
      );
      appendWrappedLine(
        lines,
        `${text.dueLabel}: ${renderDueDate(actionItem.dueDate, text)}`,
        "  ",
        "  ",
        maxLineLength,
        text,
      );
      appendReferenceLine(lines, actionItem.references, maxLineLength, text, "  ");
    }
  }
  lines.push("");
}

function appendUnresolved(
  lines: string[],
  draft: MeetingNotesDraftV1,
  maxLineLength: number,
  text: MarkdownText,
): void {
  appendHeading(lines, text.unresolvedHeading);
  if (draft.unresolvedItems.length === 0 && draft.uncertaintyNotes.length === 0) {
    appendEmpty(lines, text);
    lines.push("");
    return;
  }

  for (const item of draft.unresolvedItems) {
    appendWrappedLine(
      lines,
      `${cleanInline(item.text)} (${text.reasonLabel}: ${cleanInline(item.reason)})`,
      `- ${text.unresolvedLabel}: `,
      "  ",
      maxLineLength,
      text,
    );
    appendReferenceLine(lines, item.references, maxLineLength, text, "  ");
  }
  for (const note of draft.uncertaintyNotes) {
    appendWrappedLine(
      lines,
      cleanInline(note.text),
      `- ${text.uncertainLabel}: `,
      "  ",
      maxLineLength,
      text,
    );
    appendReferenceLine(lines, note.references, maxLineLength, text, "  ");
  }
  lines.push("");
}

function appendNoiseHandling(
  lines: string[],
  draft: MeetingNotesDraftV1,
  maxLineLength: number,
  text: MarkdownText,
): void {
  appendHeading(lines, text.noiseHeading);
  appendWrappedLine(
    lines,
    cleanInline(draft.noiseHandling.removedChatterSummary) || text.empty,
    `- ${text.removedChatterPrefix}`,
    "  ",
    maxLineLength,
    text,
  );
  if (draft.noiseHandling.keptBecause.length === 0) {
    appendWrappedLine(
      lines,
      text.empty,
      `- ${text.keptBecausePrefix}`,
      "  ",
      maxLineLength,
      text,
    );
  } else {
    appendWrappedLine(lines, text.keptBecauseHeading, "- ", "  ", maxLineLength, text);
    for (const reason of draft.noiseHandling.keptBecause) {
      appendWrappedLine(
        lines,
        cleanInline(reason),
        "  - ",
        "    ",
        maxLineLength,
        text,
      );
    }
  }
  lines.push("");
}

function appendSourceTimeline(
  lines: string[],
  draft: MeetingNotesDraftV1,
  text: MarkdownText,
): void {
  appendHeading(lines, text.sourceTimelineHeading);
  const references = collectReferences(draft);
  if (references.length === 0) {
    appendEmpty(lines, text);
    return;
  }

  for (const reference of references) {
    lines.push(`- ${formatReference(reference)}`);
  }
}

function appendHeading(lines: string[], title: string): void {
  lines.push(`## ${title}`, "");
}

function appendParagraph(
  lines: string[],
  text: string,
  maxLineLength: number,
  labels: MarkdownText,
): void {
  const cleaned = cleanInline(text);
  if (!cleaned) {
    appendEmpty(lines, labels);
    return;
  }
  appendWrappedLine(lines, cleaned, "", "", maxLineLength, labels);
}

function appendReferenceLine(
  lines: string[],
  references: readonly TimelineReference[],
  maxLineLength: number,
  text: MarkdownText,
  prefix = "",
): void {
  appendWrappedLine(
    lines,
    `${text.sourceLabel}: ${formatReferences(references, text)}`,
    prefix,
    prefix,
    maxLineLength,
    text,
  );
}

function appendEmpty(lines: string[], text: MarkdownText): void {
  lines.push(`- ${text.empty}`);
}

function renderOwner(
  owner: MeetingNotesDraftV1["actionItems"][number]["owner"],
  text: MarkdownText,
): string {
  if (owner.status === "unspecified") {
    return text.unspecified;
  }
  return cleanInline(owner.name ?? "") || text.unspecified;
}

function renderDueDate(
  dueDate: MeetingNotesDraftV1["actionItems"][number]["dueDate"],
  text: MarkdownText,
): string {
  if (dueDate.status === "unspecified") {
    return text.unspecified;
  }
  const rawText = cleanInline(dueDate.rawText ?? "");
  if (!rawText) {
    return text.unspecified;
  }
  return dueDate.isoDate ? `${rawText} (${dueDate.isoDate})` : rawText;
}

function formatReferences(
  references: readonly TimelineReference[],
  text: MarkdownText,
): string {
  if (references.length === 0) {
    return text.empty;
  }
  return references.map(formatReference).join(", ");
}

function formatReference(reference: TimelineReference): string {
  return [
    formatTimeRange(reference.startMs, reference.endMs),
    cleanInline(reference.speaker),
  ]
    .filter((part) => part.length > 0)
    .join(" ");
}

function collectReferences(draft: MeetingNotesDraftV1): TimelineReference[] {
  const byKey = new Map<string, TimelineReference>();
  const add = (references: readonly TimelineReference[]) => {
    for (const reference of references) {
      byKey.set(timelineReferenceKey(reference), reference);
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

function appendWrappedLine(
  lines: string[],
  value: string,
  prefix: string,
  continuationPrefix: string,
  maxLineLength: number,
  labels: MarkdownText,
): void {
  const cleaned = cleanInline(value) || labels.empty;
  const firstWidth = Math.max(MIN_LINE_LENGTH, maxLineLength - prefix.length);
  const continuationWidth = Math.max(
    MIN_LINE_LENGTH,
    maxLineLength - continuationPrefix.length,
  );
  const wrapped = wrapText(cleaned, firstWidth, continuationWidth);
  wrapped.forEach((line, index) => {
    lines.push(`${index === 0 ? prefix : continuationPrefix}${line}`);
  });
}

function wrapText(
  text: string,
  firstWidth: number,
  continuationWidth: number,
): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) {
    return [""];
  }

  const lines: string[] = [];
  let current = "";
  let width = firstWidth;

  for (const word of words.flatMap((entry) => splitLongToken(entry, width))) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= width) {
      current = next;
      continue;
    }
    if (current) {
      lines.push(current);
    }
    current = word;
    width = continuationWidth;
  }

  if (current) {
    lines.push(current);
  }
  return lines.length > 0 ? lines : [text];
}

function splitLongToken(token: string, width: number): string[] {
  if (token.length <= width) {
    return [token];
  }
  const chunks: string[] = [];
  for (let index = 0; index < token.length; index += width) {
    chunks.push(token.slice(index, index + width));
  }
  return chunks;
}

function cleanInline(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function formatTimeRange(startMs: number, endMs: number): string {
  return `${formatTime(startMs)}-${formatTime(endMs)}`;
}

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return [
      String(hours).padStart(2, "0"),
      String(minutes).padStart(2, "0"),
      String(seconds).padStart(2, "0"),
    ].join(":");
  }
  return [String(minutes).padStart(2, "0"), String(seconds).padStart(2, "0")].join(
    ":",
  );
}

function trimTrailingBlankLines(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1]?.trim() === "") {
    end -= 1;
  }
  return lines.slice(0, end);
}
