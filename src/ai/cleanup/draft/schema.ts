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
    "notionProperties",
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
    notionProperties: {
      type: "object",
      additionalProperties: {
        type: "object",
        additionalProperties: false,
        required: ["values"],
        properties: {
          values: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
    },
  },
} as const;

export const TOP_LEVEL_KEYS = [
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
  "notionProperties",
] as const;

export const SOURCE_TIMELINE_KEYS = ["contractVersion", "inputHash", "entryCount"] as const;
export const TIMELINE_REFERENCE_KEYS = [
  "chunkId",
  "sttJobId",
  "startMs",
  "endMs",
  "speaker",
] as const;
export const MEETING_TITLE_KEYS = ["text", "confidence", "references"] as const;
export const SUMMARY_KEYS = ["text", "references"] as const;
export const TOPIC_KEYS = ["id", "title", "summary", "references"] as const;
export const DECISION_KEYS = ["id", "title", "detail", "status", "references"] as const;
export const ACTION_ITEM_KEYS = ["id", "task", "owner", "dueDate", "references"] as const;
export const UNRESOLVED_ITEM_KEYS = ["id", "text", "reason", "references"] as const;
export const UNCERTAINTY_NOTE_KEYS = ["id", "text", "references"] as const;
export const NOISE_HANDLING_KEYS = ["removedChatterSummary", "keptBecause"] as const;
export const EVIDENCE_BOUND_PERSON_KEYS = [
  "status",
  "name",
  "userId",
  "evidence",
] as const;
export const EVIDENCE_BOUND_DATE_KEYS = [
  "status",
  "rawText",
  "isoDate",
  "evidence",
] as const;
