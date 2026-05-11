import type {
  Phase4TranscriptTimeline,
  Phase4TranscriptTimelineEntry,
} from "../../../transcript/timeline.js";
import type { TimelineReference } from "./types.js";

export function timelineReferenceKey(
  reference: Pick<TimelineReference, "chunkId" | "sttJobId">,
): string;
export function timelineReferenceKey(chunkId: string, sttJobId: string): string;
export function timelineReferenceKey(
  referenceOrChunkId: Pick<TimelineReference, "chunkId" | "sttJobId"> | string,
  sttJobId?: string,
): string {
  if (typeof referenceOrChunkId === "string") {
    return `${referenceOrChunkId}\u0000${sttJobId ?? ""}`;
  }
  return `${referenceOrChunkId.chunkId}\u0000${referenceOrChunkId.sttJobId}`;
}

export function buildTimelineReferenceIndex(
  timeline: Phase4TranscriptTimeline,
): Map<string, Phase4TranscriptTimelineEntry> {
  const index = new Map<string, Phase4TranscriptTimelineEntry>();
  for (const entry of timeline.entries) {
    index.set(timelineReferenceKey(entry.chunkId, entry.sttJobId), entry);
  }
  return index;
}

export function getReferencedTimelineEntries(
  value: unknown,
  timeline: Phase4TranscriptTimeline,
): Phase4TranscriptTimelineEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const index = buildTimelineReferenceIndex(timeline);
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
    const timelineEntry = index.get(timelineReferenceKey(chunkId, sttJobId));
    if (timelineEntry) {
      entries.push(timelineEntry);
    }
  }
  return entries;
}

export function toTimelineReference(
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
