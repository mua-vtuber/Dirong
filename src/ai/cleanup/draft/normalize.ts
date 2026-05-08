import type {
  Phase4TranscriptTimeline,
  Phase4TranscriptTimelineEntry,
} from "../../../transcript/timeline.js";
import type {
  EvidenceBoundDate,
  EvidenceBoundPerson,
  TimelineReference,
} from "./types.js";

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

function buildReferenceIndex(
  timeline: Phase4TranscriptTimeline,
): Map<string, Phase4TranscriptTimelineEntry> {
  const index = new Map<string, Phase4TranscriptTimelineEntry>();
  for (const entry of timeline.entries) {
    index.set(referenceKey(entry.chunkId, entry.sttJobId), entry);
  }
  return index;
}

function referenceKey(chunkId: string, sttJobId: string): string {
  return `${chunkId}\u0000${sttJobId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
