import type {
  Phase4TranscriptTimeline,
  Phase4TranscriptTimelineEntry,
} from "../../../transcript/timeline.js";
import {
  ACTION_ITEM_KEYS,
  DECISION_KEYS,
  EVIDENCE_BOUND_DATE_KEYS,
  EVIDENCE_BOUND_PERSON_KEYS,
  MEETING_NOTES_DRAFT_SCHEMA_VERSION,
  MEETING_TITLE_KEYS,
  NOISE_HANDLING_KEYS,
  SOURCE_TIMELINE_KEYS,
  SUMMARY_KEYS,
  TIMELINE_REFERENCE_KEYS,
  TOPIC_KEYS,
  TOP_LEVEL_KEYS,
  UNCERTAINTY_NOTE_KEYS,
  UNRESOLVED_ITEM_KEYS,
} from "./schema.js";
import type { MeetingNotesDraftV1 } from "./types.js";
import { normalizeMeetingNotesDraftShape } from "./normalize.js";
import {
  buildTimelineReferenceIndex,
  timelineReferenceKey,
} from "./reference-index.js";

export class DraftValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`AI meeting notes draft validation failed: ${issues.join("; ")}`);
    this.name = "DraftValidationError";
  }
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
  const references = buildTimelineReferenceIndex(context.timeline);

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

    const sourceEntry = references.get(timelineReferenceKey(chunkId, sttJobId));
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

const RELATIVE_DATE_PATTERN =
  /오늘|내일|모레|글피|이번|다음|월요일|화요일|수요일|목요일|금요일|토요일|일요일|주말|오전|오후/;
