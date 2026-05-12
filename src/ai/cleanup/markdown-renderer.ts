import type { MeetingNotesDraftV1, TimelineReference } from "./draft.js";
import { timelineReferenceKey } from "./draft/reference-index.js";

export type MeetingNotesMarkdownRenderOptions = {
  maxLineLength?: number;
};

const DEFAULT_MAX_LINE_LENGTH = 100;
const MIN_LINE_LENGTH = 48;

export function renderMeetingNotesDraftMarkdown(
  draft: MeetingNotesDraftV1,
  options: MeetingNotesMarkdownRenderOptions = {},
): string {
  const maxLineLength = Math.max(
    MIN_LINE_LENGTH,
    options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH,
  );
  const lines: string[] = [];

  lines.push(`# ${cleanInline(draft.meetingTitle.text) || "회의록 초안"}`, "");
  appendSummary(lines, draft, maxLineLength);
  appendTopics(lines, draft, maxLineLength);
  appendDecisions(lines, draft, maxLineLength);
  appendActionItems(lines, draft, maxLineLength);
  appendUnresolved(lines, draft, maxLineLength);
  appendNoiseHandling(lines, draft, maxLineLength);
  appendSourceTimeline(lines, draft);

  return trimTrailingBlankLines(lines).join("\n");
}

function appendSummary(
  lines: string[],
  draft: MeetingNotesDraftV1,
  maxLineLength: number,
): void {
  appendHeading(lines, "요약");
  appendParagraph(lines, draft.summary.text, maxLineLength);
  appendReferenceLine(lines, draft.summary.references, maxLineLength);
  lines.push("");
}

function appendTopics(
  lines: string[],
  draft: MeetingNotesDraftV1,
  maxLineLength: number,
): void {
  appendHeading(lines, "주요 주제");
  if (draft.topics.length === 0) {
    appendEmpty(lines);
  } else {
    for (const topic of draft.topics) {
      appendWrappedLine(
        lines,
        `**${cleanInline(topic.title)}**: ${cleanInline(topic.summary)}`,
        "- ",
        "  ",
        maxLineLength,
      );
      appendReferenceLine(lines, topic.references, maxLineLength, "  ");
    }
  }
  lines.push("");
}

function appendDecisions(
  lines: string[],
  draft: MeetingNotesDraftV1,
  maxLineLength: number,
): void {
  appendHeading(lines, "결정 사항");
  if (draft.decisions.length === 0) {
    appendEmpty(lines);
  } else {
    for (const decision of draft.decisions) {
      const status = decision.status === "decided" ? "확정" : "잠정";
      appendWrappedLine(
        lines,
        `[${status}] ${cleanInline(decision.title)}: ${cleanInline(decision.detail)}`,
        "- ",
        "  ",
        maxLineLength,
      );
      appendReferenceLine(lines, decision.references, maxLineLength, "  ");
    }
  }
  lines.push("");
}

function appendActionItems(
  lines: string[],
  draft: MeetingNotesDraftV1,
  maxLineLength: number,
): void {
  appendHeading(lines, "할 일 목록");
  if (draft.actionItems.length === 0) {
    appendEmpty(lines);
  } else {
    for (const actionItem of draft.actionItems) {
      appendWrappedLine(
        lines,
        cleanInline(actionItem.task),
        "- ",
        "  ",
        maxLineLength,
      );
      appendWrappedLine(
        lines,
        `담당: ${renderOwner(actionItem.owner)}`,
        "  ",
        "  ",
        maxLineLength,
      );
      appendWrappedLine(
        lines,
        `기한: ${renderDueDate(actionItem.dueDate)}`,
        "  ",
        "  ",
        maxLineLength,
      );
      appendReferenceLine(lines, actionItem.references, maxLineLength, "  ");
    }
  }
  lines.push("");
}

function appendUnresolved(
  lines: string[],
  draft: MeetingNotesDraftV1,
  maxLineLength: number,
): void {
  appendHeading(lines, "미해결/불확실한 항목");
  if (draft.unresolvedItems.length === 0 && draft.uncertaintyNotes.length === 0) {
    appendEmpty(lines);
    lines.push("");
    return;
  }

  for (const item of draft.unresolvedItems) {
    appendWrappedLine(
      lines,
      `${cleanInline(item.text)} (이유: ${cleanInline(item.reason)})`,
      "- 미해결: ",
      "  ",
      maxLineLength,
    );
    appendReferenceLine(lines, item.references, maxLineLength, "  ");
  }
  for (const note of draft.uncertaintyNotes) {
    appendWrappedLine(
      lines,
      cleanInline(note.text),
      "- 불확실: ",
      "  ",
      maxLineLength,
    );
    appendReferenceLine(lines, note.references, maxLineLength, "  ");
  }
  lines.push("");
}

function appendNoiseHandling(
  lines: string[],
  draft: MeetingNotesDraftV1,
  maxLineLength: number,
): void {
  appendHeading(lines, "잡담/노이즈 처리");
  appendWrappedLine(
    lines,
    cleanInline(draft.noiseHandling.removedChatterSummary) || "없음",
    "- 제거/압축: ",
    "  ",
    maxLineLength,
  );
  if (draft.noiseHandling.keptBecause.length === 0) {
    appendWrappedLine(lines, "없음", "- 보존 이유: ", "  ", maxLineLength);
  } else {
    appendWrappedLine(lines, "보존 이유:", "- ", "  ", maxLineLength);
    for (const reason of draft.noiseHandling.keptBecause) {
      appendWrappedLine(lines, cleanInline(reason), "  - ", "    ", maxLineLength);
    }
  }
  lines.push("");
}

function appendSourceTimeline(
  lines: string[],
  draft: MeetingNotesDraftV1,
): void {
  appendHeading(lines, "출처 타임라인");
  const references = collectReferences(draft);
  if (references.length === 0) {
    appendEmpty(lines);
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
): void {
  const cleaned = cleanInline(text);
  if (!cleaned) {
    appendEmpty(lines);
    return;
  }
  appendWrappedLine(lines, cleaned, "", "", maxLineLength);
}

function appendReferenceLine(
  lines: string[],
  references: readonly TimelineReference[],
  maxLineLength: number,
  prefix = "",
): void {
  appendWrappedLine(
    lines,
    `출처: ${formatReferences(references)}`,
    prefix,
    prefix,
    maxLineLength,
  );
}

function appendEmpty(lines: string[]): void {
  lines.push("- 없음");
}

function renderOwner(owner: MeetingNotesDraftV1["actionItems"][number]["owner"]): string {
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
  const rawText = cleanInline(dueDate.rawText ?? "");
  if (!rawText) {
    return "미지정";
  }
  return dueDate.isoDate ? `${rawText} (${dueDate.isoDate})` : rawText;
}

function formatReferences(references: readonly TimelineReference[]): string {
  if (references.length === 0) {
    return "없음";
  }
  return references.map(formatReference).join(", ");
}

function formatReference(reference: TimelineReference): string {
  return [
    `\`${reference.chunkId}\`/\`${reference.sttJobId}\``,
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
  text: string,
  prefix: string,
  continuationPrefix: string,
  maxLineLength: number,
): void {
  const cleaned = cleanInline(text) || "없음";
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
