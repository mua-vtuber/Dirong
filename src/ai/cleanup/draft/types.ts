import type { MEETING_NOTES_DRAFT_SCHEMA_VERSION } from "./schema.js";

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

export type NotionPropertyExtraction = {
  values: string[];
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
  notionProperties: Record<string, NotionPropertyExtraction>;
};
