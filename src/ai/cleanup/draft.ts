import type {
  Phase4TranscriptTimeline,
  Phase4TranscriptTimelineEntry,
} from "../../transcript/timeline.js";

export const MEETING_NOTES_DRAFT_SCHEMA_VERSION =
  "dirong.meeting_notes_draft.v1";

export const MEETING_NOTES_DRAFT_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  $defs: {
    timelineReference: {
      type: "object",
      additionalProperties: false,
      required: ["chunkId", "sttJobId", "startMs", "endMs", "speaker"],
      properties: {
        chunkId: { type: "string" },
        sttJobId: { type: "string" },
        startMs: { type: "number" },
        endMs: { type: "number" },
        speaker: { type: "string" },
      },
    },
    timelineReferences: {
      type: "array",
      items: { $ref: "#/$defs/timelineReference" },
    },
    evidenceBoundPerson: {
      type: "object",
      additionalProperties: false,
      required: ["status", "name", "userId", "evidence"],
      properties: {
        status: { enum: ["explicit", "unspecified"] },
        name: { type: ["string", "null"] },
        userId: { type: ["string", "null"] },
        evidence: { $ref: "#/$defs/timelineReferences" },
      },
    },
    evidenceBoundDate: {
      type: "object",
      additionalProperties: false,
      required: ["status", "rawText", "isoDate", "evidence"],
      properties: {
        status: { enum: ["explicit", "unspecified"] },
        rawText: { type: ["string", "null"] },
        isoDate: { type: ["string", "null"] },
        evidence: { $ref: "#/$defs/timelineReferences" },
      },
    },
  },
  required: [
    "schemaVersion",
    "language",
    "sessionId",
    "sourceTimeline",
    "meetingTitle",
    "summary",
    "topics",
    "decisions",
    "actionItems",
    "unresolvedItems",
    "uncertaintyNotes",
    "noiseHandling",
  ],
  properties: {
    schemaVersion: { const: MEETING_NOTES_DRAFT_SCHEMA_VERSION },
    language: { const: "ko" },
    sessionId: { type: "string" },
    sourceTimeline: {
      type: "object",
      additionalProperties: false,
      required: ["contractVersion", "inputHash", "entryCount"],
      properties: {
        contractVersion: { const: "phase3.5-transcript-timeline-v1" },
        inputHash: { type: "string" },
        entryCount: { type: "number" },
      },
    },
    meetingTitle: {
      type: "object",
      additionalProperties: false,
      required: ["text", "confidence", "references"],
      properties: {
        text: { type: "string" },
        confidence: { enum: ["high", "medium", "low"] },
        references: { $ref: "#/$defs/timelineReferences" },
      },
    },
    summary: {
      type: "object",
      additionalProperties: false,
      required: ["text", "references"],
      properties: {
        text: { type: "string" },
        references: { $ref: "#/$defs/timelineReferences" },
      },
    },
    topics: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "summary", "references"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          references: { $ref: "#/$defs/timelineReferences" },
        },
      },
    },
    decisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "detail", "status", "references"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          detail: { type: "string" },
          status: { enum: ["decided", "tentative"] },
          references: { $ref: "#/$defs/timelineReferences" },
        },
      },
    },
    actionItems: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "task", "owner", "dueDate", "references"],
        properties: {
          id: { type: "string" },
          task: { type: "string" },
          owner: { $ref: "#/$defs/evidenceBoundPerson" },
          dueDate: { $ref: "#/$defs/evidenceBoundDate" },
          references: { $ref: "#/$defs/timelineReferences" },
        },
      },
    },
    unresolvedItems: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "text", "reason", "references"],
        properties: {
          id: { type: "string" },
          text: { type: "string" },
          reason: { type: "string" },
          references: { $ref: "#/$defs/timelineReferences" },
        },
      },
    },
    uncertaintyNotes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "text", "references"],
        properties: {
          id: { type: "string" },
          text: { type: "string" },
          references: { $ref: "#/$defs/timelineReferences" },
        },
      },
    },
    noiseHandling: {
      type: "object",
      additionalProperties: false,
      required: ["removedChatterSummary", "keptBecause"],
      properties: {
        removedChatterSummary: { type: "string" },
        keptBecause: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
  },
} as const;

export type TimelineReference = {
  chunkId: string;
  sttJobId: string;
  startMs: number;
  endMs: number;
  speaker: string;
};

export type EvidenceBoundPerson = {
  status: "explicit" | "unspecified";
  name: string | null;
  userId: string | null;
  evidence: TimelineReference[];
};

export type EvidenceBoundDate = {
  status: "explicit" | "unspecified";
  rawText: string | null;
  isoDate: string | null;
  evidence: TimelineReference[];
};

export type MeetingNotesDraftV1 = {
  schemaVersion: typeof MEETING_NOTES_DRAFT_SCHEMA_VERSION;
  language: "ko";
  sessionId: string;
  sourceTimeline: {
    contractVersion: "phase3.5-transcript-timeline-v1";
    inputHash: string;
    entryCount: number;
  };
  meetingTitle: {
    text: string;
    confidence: "high" | "medium" | "low";
    references: TimelineReference[];
  };
  summary: {
    text: string;
    references: TimelineReference[];
  };
  topics: Array<{
    id: string;
    title: string;
    summary: string;
    references: TimelineReference[];
  }>;
  decisions: Array<{
    id: string;
    title: string;
    detail: string;
    status: "decided" | "tentative";
    references: TimelineReference[];
  }>;
  actionItems: Array<{
    id: string;
    task: string;
    owner: EvidenceBoundPerson;
    dueDate: EvidenceBoundDate;
    references: TimelineReference[];
  }>;
  unresolvedItems: Array<{
    id: string;
    text: string;
    reason: string;
    references: TimelineReference[];
  }>;
  uncertaintyNotes: Array<{
    id: string;
    text: string;
    references: TimelineReference[];
  }>;
  noiseHandling: {
    removedChatterSummary: string;
    keptBecause: string[];
  };
};

const TOP_LEVEL_KEYS = [
  "schemaVersion",
  "language",
  "sessionId",
  "sourceTimeline",
  "meetingTitle",
  "summary",
  "topics",
  "decisions",
  "actionItems",
  "unresolvedItems",
  "uncertaintyNotes",
  "noiseHandling",
] as const;

const SOURCE_TIMELINE_KEYS = ["contractVersion", "inputHash", "entryCount"] as const;
const TIMELINE_REFERENCE_KEYS = [
  "chunkId",
  "sttJobId",
  "startMs",
  "endMs",
  "speaker",
] as const;
const MEETING_TITLE_KEYS = ["text", "confidence", "references"] as const;
const SUMMARY_KEYS = ["text", "references"] as const;
const TOPIC_KEYS = ["id", "title", "summary", "references"] as const;
const DECISION_KEYS = ["id", "title", "detail", "status", "references"] as const;
const ACTION_ITEM_KEYS = ["id", "task", "owner", "dueDate", "references"] as const;
const UNRESOLVED_ITEM_KEYS = ["id", "text", "reason", "references"] as const;
const UNCERTAINTY_NOTE_KEYS = ["id", "text", "references"] as const;
const NOISE_HANDLING_KEYS = ["removedChatterSummary", "keptBecause"] as const;
const EVIDENCE_BOUND_PERSON_KEYS = [
  "status",
  "name",
  "userId",
  "evidence",
] as const;
const EVIDENCE_BOUND_DATE_KEYS = [
  "status",
  "rawText",
  "isoDate",
  "evidence",
] as const;

export class DraftParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftParseError";
  }
}

export class DraftValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`AI meeting notes draft validation failed: ${issues.join("; ")}`);
    this.name = "DraftValidationError";
  }
}

export function parseMeetingNotesDraftFromRawText(rawText: string): unknown {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new DraftParseError("provider output is empty");
  }

  const parsed = extractJsonValueFromText(trimmed);
  if (parsed.ok) {
    return unwrapProviderEnvelope(parsed.value, 0);
  }

  throw new DraftParseError("provider output did not contain valid JSON");
}

export function normalizeMeetingNotesDraftShape(
  value: unknown,
  context?: {
    timeline: Phase4TranscriptTimeline;
  },
): unknown {
  if (!isRecord(value)) {
    return value;
  }

  let normalized: Record<string, unknown> = value;
  let changed = false;
  if (Object.prototype.hasOwnProperty.call(normalized, "markdown")) {
    normalized = { ...normalized };
    delete normalized.markdown;
    changed = true;
  }

  const actionItems = normalizeActionItems(normalized.actionItems, context);
  if (actionItems.changed) {
    normalized = { ...normalized, actionItems: actionItems.value };
    changed = true;
  }

  const noiseHandling = normalized.noiseHandling;
  if (!isRecord(noiseHandling)) {
    return changed ? normalized : value;
  }

  const keptBecause = normalizeKeptBecause(noiseHandling.keptBecause);
  if (!keptBecause.changed) {
    return changed ? normalized : value;
  }

  return {
    ...normalized,
    noiseHandling: {
      ...noiseHandling,
      keptBecause: keptBecause.value,
    },
  };
}

export function validateMeetingNotesDraftV1(
  value: unknown,
  context: {
    sessionId: string;
    inputHash: string;
    timeline: Phase4TranscriptTimeline;
  },
): MeetingNotesDraftV1 {
  const issues: string[] = [];
  const normalizedValue = normalizeMeetingNotesDraftShape(value, {
    timeline: context.timeline,
  });
  const draft = asRecord(normalizedValue, "draft", issues);
  expectKnownKeys(draft, "draft", TOP_LEVEL_KEYS, issues);
  const references = buildReferenceIndex(context.timeline);

  expectEqual(
    draft.schemaVersion,
    MEETING_NOTES_DRAFT_SCHEMA_VERSION,
    "schemaVersion",
    issues,
  );
  expectEqual(draft.language, "ko", "language", issues);
  expectEqual(draft.sessionId, context.sessionId, "sessionId", issues);

  const sourceTimeline = asRecord(draft.sourceTimeline, "sourceTimeline", issues);
  expectKnownKeys(
    sourceTimeline,
    "sourceTimeline",
    SOURCE_TIMELINE_KEYS,
    issues,
  );
  expectEqual(
    sourceTimeline.contractVersion,
    context.timeline.contractVersion,
    "sourceTimeline.contractVersion",
    issues,
  );
  expectEqual(
    sourceTimeline.inputHash,
    context.inputHash,
    "sourceTimeline.inputHash",
    issues,
  );
  expectEqual(
    sourceTimeline.entryCount,
    context.timeline.entries.length,
    "sourceTimeline.entryCount",
    issues,
  );

  const meetingTitle = asRecord(draft.meetingTitle, "meetingTitle", issues);
  expectKnownKeys(meetingTitle, "meetingTitle", MEETING_TITLE_KEYS, issues);
  expectString(meetingTitle.text, "meetingTitle.text", issues);
  expectOneOf(
    meetingTitle.confidence,
    ["high", "medium", "low"],
    "meetingTitle.confidence",
    issues,
  );
  validateReferenceArray(
    meetingTitle.references,
    "meetingTitle.references",
    references,
    issues,
  );

  const summary = asRecord(draft.summary, "summary", issues);
  expectKnownKeys(summary, "summary", SUMMARY_KEYS, issues);
  expectString(summary.text, "summary.text", issues);
  validateReferenceArray(summary.references, "summary.references", references, issues);

  validateReferencedItems(
    draft.topics,
    "topics",
    references,
    issues,
    validateTopic,
  );
  validateReferencedItems(
    draft.decisions,
    "decisions",
    references,
    issues,
    validateDecision,
  );
  validateReferencedItems(
    draft.actionItems,
    "actionItems",
    references,
    issues,
    (item, path, itemEntries, itemIssues) =>
      validateActionItem(item, path, itemEntries, references, itemIssues),
  );
  validateReferencedItems(
    draft.unresolvedItems,
    "unresolvedItems",
    references,
    issues,
    validateUnresolvedItem,
  );
  validateReferencedItems(
    draft.uncertaintyNotes,
    "uncertaintyNotes",
    references,
    issues,
    validateUncertaintyNote,
    false,
  );

  const noiseHandling = asRecord(draft.noiseHandling, "noiseHandling", issues);
  expectKnownKeys(noiseHandling, "noiseHandling", NOISE_HANDLING_KEYS, issues);
  expectString(
    noiseHandling.removedChatterSummary,
    "noiseHandling.removedChatterSummary",
    issues,
  );
  if (!Array.isArray(noiseHandling.keptBecause)) {
    issues.push("noiseHandling.keptBecause must be an array");
  } else {
    noiseHandling.keptBecause.forEach((entry, index) => {
      expectString(entry, `noiseHandling.keptBecause[${index}]`, issues);
    });
  }

  if (issues.length > 0) {
    throw new DraftValidationError(issues);
  }

  return normalizedValue as MeetingNotesDraftV1;
}

function unwrapProviderEnvelope(value: unknown, depth: number): unknown {
  if (depth > 4) {
    return value;
  }

  const record = isRecord(value) ? value : null;
  if (!record) {
    return value;
  }

  if (record.schemaVersion === MEETING_NOTES_DRAFT_SCHEMA_VERSION) {
    return record;
  }

  const structuredOutput = unwrapEnvelopeEntry(record.structured_output, depth);
  if (structuredOutput.ok) {
    return structuredOutput.value;
  }

  for (const key of ["result", "response", "text", "content", "message"]) {
    const unwrapped = unwrapEnvelopeEntry(record[key], depth);
    if (unwrapped.ok) {
      return unwrapped.value;
    }
  }

  const content = record.content;
  if (Array.isArray(content)) {
    const text = content
      .map((item) =>
        isRecord(item) && typeof item.text === "string" ? item.text : "",
      )
      .join("\n")
      .trim();
    if (text.length > 0) {
      const parsed = extractJsonValueFromText(text);
      if (parsed.ok) {
        return unwrapProviderEnvelope(parsed.value, depth + 1);
      }
    }
  }

  return value;
}

function unwrapEnvelopeEntry(
  entry: unknown,
  depth: number,
): { ok: true; value: unknown } | { ok: false } {
  if (isRecord(entry)) {
    return { ok: true, value: unwrapProviderEnvelope(entry, depth + 1) };
  }

  if (typeof entry !== "string") {
    return { ok: false };
  }

  const parsed = extractJsonValueFromText(entry);
  if (!parsed.ok) {
    return { ok: false };
  }

  return { ok: true, value: unwrapProviderEnvelope(parsed.value, depth + 1) };
}

function extractJsonValueFromText(
  text: string,
): { ok: true; value: unknown } | { ok: false } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false };
  }

  const direct = tryParseJson(trimmed);
  if (direct.ok) {
    return direct;
  }

  for (const fenced of extractJsonFences(trimmed).reverse()) {
    const parsed = tryParseJson(fenced);
    if (parsed.ok) {
      return parsed;
    }
  }

  const trailingLine = extractTrailingJsonLine(trimmed);
  if (trailingLine) {
    const parsed = tryParseJson(trailingLine);
    if (parsed.ok) {
      return parsed;
    }
  }

  const lastObject = extractLastJsonObjectBlock(trimmed);
  if (lastObject) {
    const parsed = tryParseJson(lastObject);
    if (parsed.ok) {
      return parsed;
    }
  }

  return { ok: false };
}

function extractJsonFences(text: string): string[] {
  const fences: string[] = [];
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const body = match[1]?.trim();
    if (body) {
      fences.push(body);
    }
  }
  return fences;
}

function extractTrailingJsonLine(text: string): string | null {
  const lines = text.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim() ?? "";
    if (!line) {
      continue;
    }
    if (
      (line.startsWith("{") && line.endsWith("}")) ||
      (line.startsWith("[") && line.endsWith("]"))
    ) {
      return line;
    }
  }
  return null;
}

function extractLastJsonObjectBlock(text: string): string | null {
  let depth = 0;
  let inString = false;
  let stringChar = "";
  let escaped = false;
  let currentStart = -1;
  let candidateStart = -1;
  let candidateEnd = -1;

  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === stringChar) {
        inString = false;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      inString = true;
      stringChar = char;
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        currentStart = index;
      }
      depth += 1;
      continue;
    }

    if (char === "}") {
      if (depth === 0) {
        continue;
      }
      depth -= 1;
      if (depth === 0 && currentStart >= 0) {
        candidateStart = currentStart;
        candidateEnd = index;
      }
    }
  }

  if (candidateStart < 0 || candidateEnd < 0) {
    return null;
  }

  return text.slice(candidateStart, candidateEnd + 1);
}

function normalizeKeptBecause(
  value: unknown,
): { changed: true; value: string[] } | { changed: false } {
  if (typeof value === "string") {
    return { changed: true, value: [value] };
  }

  if (!Array.isArray(value)) {
    return { changed: false };
  }

  const normalized: string[] = [];
  let changed = false;
  for (const entry of value) {
    if (typeof entry === "string") {
      normalized.push(entry);
      continue;
    }
    if (isRecord(entry) && typeof entry.reason === "string") {
      normalized.push(entry.reason);
      changed = true;
      continue;
    }
    return { changed: false };
  }

  return changed ? { changed: true, value: normalized } : { changed: false };
}

function normalizeActionItems(
  value: unknown,
  context?: {
    timeline: Phase4TranscriptTimeline;
  },
): { changed: true; value: unknown[] } | { changed: false } {
  if (!Array.isArray(value)) {
    return { changed: false };
  }

  let changed = false;
  const normalizedItems = value.map((entry) => {
    if (!isRecord(entry)) {
      return entry;
    }

    let item: Record<string, unknown> = entry;
    const referencedEntries = context
      ? getReferencedTimelineEntries(entry.references, context.timeline)
      : [];

    const owner = normalizeOwnerShape(entry.owner);
    if (owner.changed) {
      item = { ...item, owner: owner.value };
      changed = true;
    }

    const dueDate = normalizeDueDateShape(entry.dueDate, referencedEntries);
    if (dueDate.changed) {
      item = { ...item, dueDate: dueDate.value };
      changed = true;
    }

    return item;
  });

  return changed ? { changed: true, value: normalizedItems } : { changed: false };
}

function normalizeOwnerShape(
  value: unknown,
): { changed: true; value: EvidenceBoundPerson } | { changed: false } {
  if (isUnspecifiedMarker(value)) {
    return { changed: true, value: makeUnspecifiedOwner() };
  }

  if (!isRecord(value)) {
    return { changed: false };
  }

  if (
    value.status === "unspecified" ||
    (
      value.status === undefined &&
      (value.name === null || value.name === undefined) &&
      (value.userId === null || value.userId === undefined)
    )
  ) {
    return { changed: true, value: makeUnspecifiedOwner() };
  }

  return { changed: false };
}

function normalizeDueDateShape(
  value: unknown,
  referencedEntries: Phase4TranscriptTimelineEntry[],
): { changed: true; value: EvidenceBoundDate } | { changed: false } {
  if (isUnspecifiedMarker(value)) {
    return { changed: true, value: makeUnspecifiedDueDate() };
  }

  if (!isRecord(value)) {
    return { changed: false };
  }

  if (value.status === "unspecified") {
    return { changed: true, value: makeUnspecifiedDueDate() };
  }

  const rawText = typeof value.rawText === "string" ? value.rawText.trim() : "";
  if (!rawText) {
    if (value.status === undefined) {
      return { changed: true, value: makeUnspecifiedDueDate() };
    }
    return { changed: false };
  }

  const supported = referencedEntries.some((entry) => entry.text.includes(rawText));
  if (!supported) {
    return { changed: true, value: makeUnspecifiedDueDate() };
  }

  if (value.status === undefined || value.status === "explicit") {
    return {
      changed: true,
      value: {
        status: "explicit",
        rawText,
        isoDate: typeof value.isoDate === "string" ? value.isoDate : null,
        evidence: Array.isArray(value.evidence)
          ? value.evidence as TimelineReference[]
          : referencedEntries.map(toTimelineReference),
      },
    };
  }

  return { changed: false };
}

function getReferencedTimelineEntries(
  value: unknown,
  timeline: Phase4TranscriptTimeline,
): Phase4TranscriptTimelineEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const index = buildReferenceIndex(timeline);
  const entries: Phase4TranscriptTimelineEntry[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const chunkId = entry.chunkId;
    const sttJobId = entry.sttJobId;
    if (typeof chunkId !== "string" || typeof sttJobId !== "string") {
      continue;
    }
    const timelineEntry = index.get(referenceKey(chunkId, sttJobId));
    if (timelineEntry) {
      entries.push(timelineEntry);
    }
  }
  return entries;
}

function toTimelineReference(
  entry: Phase4TranscriptTimelineEntry,
): TimelineReference {
  return {
    chunkId: entry.chunkId,
    sttJobId: entry.sttJobId,
    startMs: entry.startMs,
    endMs: entry.endMs,
    speaker: entry.displayNameSnapshot,
  };
}

function isUnspecifiedMarker(value: unknown): boolean {
  if (value === null) {
    return true;
  }
  if (typeof value !== "string") {
    return false;
  }
  return /^(unspecified|unknown|none|null|n\/a|미지정|불명|없음)$/i.test(
    value.trim(),
  );
}

function makeUnspecifiedOwner(): EvidenceBoundPerson {
  return {
    status: "unspecified",
    name: null,
    userId: null,
    evidence: [],
  };
}

function makeUnspecifiedDueDate(): EvidenceBoundDate {
  return {
    status: "unspecified",
    rawText: null,
    isoDate: null,
    evidence: [],
  };
}

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function buildReferenceIndex(
  timeline: Phase4TranscriptTimeline,
): Map<string, Phase4TranscriptTimelineEntry> {
  const index = new Map<string, Phase4TranscriptTimelineEntry>();
  for (const entry of timeline.entries) {
    index.set(referenceKey(entry.chunkId, entry.sttJobId), entry);
  }
  return index;
}

function validateReferencedItems(
  value: unknown,
  path: string,
  references: Map<string, Phase4TranscriptTimelineEntry>,
  issues: string[],
  validateItem: (
    item: Record<string, unknown>,
    path: string,
    referencedEntries: Phase4TranscriptTimelineEntry[],
    issues: string[],
  ) => void,
  requireReferences = true,
): void {
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array`);
    return;
  }

  value.forEach((entry, index) => {
    const itemPath = `${path}[${index}]`;
    const item = asRecord(entry, itemPath, issues);
    const referencedEntries = validateReferenceArray(
      item.references,
      `${itemPath}.references`,
      references,
      issues,
      requireReferences,
    );
    validateItem(item, itemPath, referencedEntries, issues);
  });
}

function validateTopic(
  item: Record<string, unknown>,
  path: string,
  _referencedEntries: Phase4TranscriptTimelineEntry[],
  issues: string[],
): void {
  expectKnownKeys(item, path, TOPIC_KEYS, issues);
  expectString(item.id, `${path}.id`, issues);
  expectString(item.title, `${path}.title`, issues);
  expectString(item.summary, `${path}.summary`, issues);
}

function validateDecision(
  item: Record<string, unknown>,
  path: string,
  _referencedEntries: Phase4TranscriptTimelineEntry[],
  issues: string[],
): void {
  expectKnownKeys(item, path, DECISION_KEYS, issues);
  expectString(item.id, `${path}.id`, issues);
  expectString(item.title, `${path}.title`, issues);
  expectString(item.detail, `${path}.detail`, issues);
  expectOneOf(item.status, ["decided", "tentative"], `${path}.status`, issues);
}

function validateActionItem(
  item: Record<string, unknown>,
  path: string,
  itemEntries: Phase4TranscriptTimelineEntry[],
  references: Map<string, Phase4TranscriptTimelineEntry>,
  issues: string[],
): void {
  expectKnownKeys(item, path, ACTION_ITEM_KEYS, issues);
  expectString(item.id, `${path}.id`, issues);
  expectString(item.task, `${path}.task`, issues);
  validateOwner(item.owner, `${path}.owner`, itemEntries, references, issues);
  validateDueDate(item.dueDate, `${path}.dueDate`, references, issues);
}

function validateUnresolvedItem(
  item: Record<string, unknown>,
  path: string,
  _referencedEntries: Phase4TranscriptTimelineEntry[],
  issues: string[],
): void {
  expectKnownKeys(item, path, UNRESOLVED_ITEM_KEYS, issues);
  expectString(item.id, `${path}.id`, issues);
  expectString(item.text, `${path}.text`, issues);
  expectString(item.reason, `${path}.reason`, issues);
}

function validateUncertaintyNote(
  item: Record<string, unknown>,
  path: string,
  _referencedEntries: Phase4TranscriptTimelineEntry[],
  issues: string[],
): void {
  expectKnownKeys(item, path, UNCERTAINTY_NOTE_KEYS, issues);
  expectString(item.id, `${path}.id`, issues);
  expectString(item.text, `${path}.text`, issues);
}

function validateReferenceArray(
  value: unknown,
  path: string,
  references: Map<string, Phase4TranscriptTimelineEntry>,
  issues: string[],
  requireNonEmpty = false,
): Phase4TranscriptTimelineEntry[] {
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array`);
    return [];
  }

  if (requireNonEmpty && value.length === 0) {
    issues.push(`${path} must contain at least one timeline reference`);
  }

  const entries: Phase4TranscriptTimelineEntry[] = [];
  value.forEach((entry, index) => {
    const refPath = `${path}[${index}]`;
    const ref = asRecord(entry, refPath, issues);
    const chunkId = ref.chunkId;
    const sttJobId = ref.sttJobId;
    const startMs = ref.startMs;
    const endMs = ref.endMs;
    const speaker = ref.speaker;
    expectKnownKeys(ref, refPath, TIMELINE_REFERENCE_KEYS, issues);

    if (typeof chunkId !== "string" || typeof sttJobId !== "string") {
      issues.push(`${refPath} must include chunkId and sttJobId`);
      return;
    }

    const sourceEntry = references.get(referenceKey(chunkId, sttJobId));
    if (!sourceEntry) {
      issues.push(`${refPath} does not point to a real timeline entry`);
      return;
    }

    if (startMs !== sourceEntry.startMs) {
      issues.push(`${refPath}.startMs does not match the timeline entry`);
    }
    if (endMs !== sourceEntry.endMs) {
      issues.push(`${refPath}.endMs does not match the timeline entry`);
    }
    if (speaker !== sourceEntry.displayNameSnapshot) {
      issues.push(`${refPath}.speaker does not match the timeline entry`);
    }
    entries.push(sourceEntry);
  });

  return entries;
}

function validateOwner(
  value: unknown,
  path: string,
  itemEntries: Phase4TranscriptTimelineEntry[],
  references: Map<string, Phase4TranscriptTimelineEntry>,
  issues: string[],
): void {
  const owner = asRecord(value, path, issues);
  expectKnownKeys(owner, path, EVIDENCE_BOUND_PERSON_KEYS, issues);
  if (owner.status === "unspecified") {
    if (owner.name !== null) {
      issues.push(`${path}.name must be null when owner is unspecified`);
    }
    if (owner.userId !== null) {
      issues.push(`${path}.userId must be null when owner is unspecified`);
    }
    validateReferenceArray(owner.evidence, `${path}.evidence`, references, issues);
    return;
  }

  if (owner.status !== "explicit") {
    issues.push(`${path}.status must be explicit or unspecified`);
    return;
  }

  const evidenceEntries = validateReferenceArray(
    owner.evidence,
    `${path}.evidence`,
    references,
    issues,
    true,
  );
  if (typeof owner.name !== "string" || owner.name.trim().length === 0) {
    issues.push(`${path}.name must be a non-empty string for explicit owners`);
  }
  if (owner.userId !== null && typeof owner.userId !== "string") {
    issues.push(`${path}.userId must be a string or null`);
  }
  if (
    typeof owner.userId === "string" &&
    !evidenceEntries.some((entry) => entry.userId === owner.userId)
  ) {
    issues.push(`${path}.userId is not supported by owner evidence`);
  }

  if (typeof owner.name === "string") {
    const normalizedName = owner.name.trim();
    const ownerEvidenceEntries =
      evidenceEntries.length > 0 ? evidenceEntries : itemEntries;
    const supported = ownerEvidenceEntries.some(
      (entry) =>
        entry.displayNameSnapshot === normalizedName ||
        entry.text.includes(normalizedName),
    );
    if (!supported) {
      issues.push(`${path}.name is not supported by referenced speaker or text`);
    }
  }
}

function validateDueDate(
  value: unknown,
  path: string,
  references: Map<string, Phase4TranscriptTimelineEntry>,
  issues: string[],
): void {
  const dueDate = asRecord(value, path, issues);
  expectKnownKeys(dueDate, path, EVIDENCE_BOUND_DATE_KEYS, issues);
  if (dueDate.status === "unspecified") {
    if (dueDate.rawText !== null) {
      issues.push(`${path}.rawText must be null when due date is unspecified`);
    }
    if (dueDate.isoDate !== null) {
      issues.push(`${path}.isoDate must be null when due date is unspecified`);
    }
    validateReferenceArray(dueDate.evidence, `${path}.evidence`, references, issues);
    return;
  }

  if (dueDate.status !== "explicit") {
    issues.push(`${path}.status must be explicit or unspecified`);
    return;
  }

  const evidenceEntries = validateReferenceArray(
    dueDate.evidence,
    `${path}.evidence`,
    references,
    issues,
    true,
  );
  if (typeof dueDate.rawText !== "string" || dueDate.rawText.trim().length === 0) {
    issues.push(`${path}.rawText must be a non-empty string for explicit dates`);
    return;
  }

  const rawText = dueDate.rawText.trim();
  if (!evidenceEntries.some((entry) => entry.text.includes(rawText))) {
    issues.push(`${path}.rawText is not present in referenced transcript text`);
  }

  if (dueDate.isoDate !== null) {
    if (
      typeof dueDate.isoDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(dueDate.isoDate)
    ) {
      issues.push(`${path}.isoDate must be YYYY-MM-DD or null`);
    }
    if (RELATIVE_DATE_PATTERN.test(rawText)) {
      issues.push(`${path}.isoDate must stay null for relative dates in MVP`);
    }
  }
}

function asRecord(
  value: unknown,
  path: string,
  issues: string[],
): Record<string, unknown> {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return {};
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectEqual(
  actual: unknown,
  expected: unknown,
  path: string,
  issues: string[],
): void {
  if (actual !== expected) {
    issues.push(`${path} must be ${String(expected)}`);
  }
}

function expectString(value: unknown, path: string, issues: string[]): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(`${path} must be a non-empty string`);
  }
}

function expectOneOf(
  value: unknown,
  allowed: readonly string[],
  path: string,
  issues: string[],
): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    issues.push(`${path} must be one of ${allowed.join(", ")}`);
  }
}

function expectKnownKeys(
  value: Record<string, unknown>,
  path: string,
  allowed: readonly string[],
  issues: string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      issues.push(`${path}.${key} is not allowed`);
    }
  }
}

function referenceKey(chunkId: string, sttJobId: string): string {
  return `${chunkId}\u0000${sttJobId}`;
}

const RELATIVE_DATE_PATTERN =
  /오늘|내일|모레|글피|이번|다음|월요일|화요일|수요일|목요일|금요일|토요일|일요일|주말|오전|오후/;
