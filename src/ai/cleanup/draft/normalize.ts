import type {
  Phase4TranscriptTimeline,
  Phase4TranscriptTimelineEntry,
} from "../../../transcript/timeline.js";
import type {
  EvidenceBoundDate,
  EvidenceBoundPerson,
  TimelineReference,
} from "./types.js";
import {
  getReferencedTimelineEntries,
  timelineReferenceKey,
  toTimelineReference,
} from "./reference-index.js";

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

  if (!Object.prototype.hasOwnProperty.call(normalized, "notionProperties")) {
    normalized = { ...normalized, notionProperties: {} };
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
    const references = normalizeActionItemReferences(entry, context);
    if (references.changed) {
      item = { ...item, references: references.value };
      changed = true;
    }
    const referencedEntries = references.entries;

    const owner = normalizeOwnerShape(entry.owner, referencedEntries);
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

function normalizeActionItemReferences(
  entry: Record<string, unknown>,
  context?: {
    timeline: Phase4TranscriptTimeline;
  },
):
  | {
      changed: true;
      value: TimelineReference[];
      entries: Phase4TranscriptTimelineEntry[];
    }
  | {
      changed: false;
      entries: Phase4TranscriptTimelineEntry[];
    } {
  if (!context) {
    return { changed: false, entries: [] };
  }

  const existingReferences = Array.isArray(entry.references) ? entry.references : [];
  if (existingReferences.length > 0) {
    return {
      changed: false,
      entries: getReferencedTimelineEntries(existingReferences, context.timeline),
    };
  }

  const evidenceReferences = [
    ...collectEvidenceReferences(entry.owner),
    ...collectEvidenceReferences(entry.dueDate),
  ];
  if (evidenceReferences.length === 0) {
    return { changed: false, entries: [] };
  }

  const entries = uniqueTimelineEntries(
    getReferencedTimelineEntries(evidenceReferences, context.timeline),
  );
  if (entries.length === 0) {
    return { changed: false, entries: [] };
  }

  return {
    changed: true,
    value: entries.map(toTimelineReference),
    entries,
  };
}

function collectEvidenceReferences(value: unknown): unknown[] {
  if (!isRecord(value) || !Array.isArray(value.evidence)) {
    return [];
  }
  return value.evidence;
}

function uniqueTimelineEntries(
  entries: Phase4TranscriptTimelineEntry[],
): Phase4TranscriptTimelineEntry[] {
  const seen = new Set<string>();
  const unique: Phase4TranscriptTimelineEntry[] = [];
  for (const entry of entries) {
    const key = timelineReferenceKey(entry.chunkId, entry.sttJobId);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(entry);
  }
  return unique;
}

function normalizeOwnerShape(
  value: unknown,
  referencedEntries: Phase4TranscriptTimelineEntry[],
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

  if (value.status === "specified") {
    const name = typeof value.name === "string" ? value.name.trim() : "";
    if (!name || referencedEntries.length === 0) {
      return { changed: false };
    }

    const userId = typeof value.userId === "string" ? value.userId : null;
    const supported = referencedEntries.some(
      (entry) =>
        entry.displayNameSnapshot === name ||
        entry.text.includes(name) ||
        (typeof userId === "string" && entry.userId === userId),
    );
    if (!supported) {
      return { changed: false };
    }

    return {
      changed: true,
      value: {
        status: "explicit",
        name,
        userId,
        evidence: getEvidenceOrFallback(value.evidence, referencedEntries),
      },
    };
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

  if (
    value.status === undefined ||
    value.status === "explicit" ||
    value.status === "specified"
  ) {
    return {
      changed: true,
      value: {
        status: "explicit",
        rawText,
        isoDate: typeof value.isoDate === "string" ? value.isoDate : null,
        evidence: getEvidenceOrFallback(value.evidence, referencedEntries),
      },
    };
  }

  return { changed: false };
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

function getEvidenceOrFallback(
  value: unknown,
  fallbackEntries: Phase4TranscriptTimelineEntry[],
): TimelineReference[] {
  if (Array.isArray(value) && value.length > 0) {
    return value as TimelineReference[];
  }
  return fallbackEntries.map(toTimelineReference);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
