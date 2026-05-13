import type { Phase4TimelineInput } from "./timeline-input.js";
import {
  DEFAULT_DIRONG_LOCALE,
  type DirongLocale,
} from "../../settings/local-settings-store.js";

export const PHASE4_AI_CLEANUP_PROMPT_VERSION = "phase4-ai-cleanup-v3";

export function buildPhase4SystemPrompt(
  locale: DirongLocale = DEFAULT_DIRONG_LOCALE,
): string {
  const languageName = meetingNotesLanguageName(locale);
  return [
    "You are Dirong's AI cleanup engine for Discord meeting transcripts.",
    "Create a concise meeting-notes draft from the speaker-tagged transcript timeline.",
    "The full response must be either one raw JSON object or one fenced json block containing only that object.",
    "Do not include prose before or after the JSON.",
    "Return only JSON that matches the provided schema. The app validates the schema, so do not add arbitrary keys.",
    "Do not include a markdown field. The app renders Markdown deterministically after validation.",
    "Do not write to Notion, call external tools, or request Notion credentials.",
    "Do not invent owners, dates, decisions, or facts.",
    "If something is unclear, mark it as unspecified or uncertain.",
    `Use ${languageName} for every user-facing draft string.`,
    `The top-level language field must be exactly "${locale}".`,
    "Every decision, action item, topic, unresolved item, and uncertainty must preserve source timeline references.",
    "For relative dates such as 내일, 금요일, tomorrow, or Friday, keep rawText and set isoDate to null.",
    "Remove or compress casual chatter only when it does not affect meeting meaning.",
  ].join("\n");
}

export function buildPhase4UserPrompt(
  input: Phase4TimelineInput,
  options: {
    notionCustomPropertyPrompt?: string;
    memberRosterPrompt?: string;
    locale?: DirongLocale;
  } = {},
): string {
  const locale = options.locale ?? DEFAULT_DIRONG_LOCALE;
  const languageName = meetingNotesLanguageName(locale);
  const notionCustomPropertyPrompt = options.notionCustomPropertyPrompt?.trim() ?? "";
  const memberRosterPrompt = options.memberRosterPrompt?.trim() ?? "";
  const skeletonText = meetingNotesSkeletonText(locale);
  return [
    `Task: Create a ${languageName} meeting-notes draft from this Discord transcript timeline.`,
    "",
    "Output schema version: dirong.meeting_notes_draft.v1",
    "Input contract version: phase3.5-transcript-timeline-v1",
    `Session ID: ${input.timeline.sessionId}`,
    `Input hash: ${input.inputHash}`,
    `Entry count: ${input.timeline.entries.length}`,
    "",
    "Rules:",
    "- Return a single raw JSON object, or one fenced json block containing only that object.",
    "- Do not include prose, explanations, Markdown content, or multiple JSON blocks.",
    "- Use exactly these top-level keys: schemaVersion, language, sessionId, sourceTimeline, meetingTitle, summary, topics, decisions, actionItems, unresolvedItems, uncertaintyNotes, noiseHandling, notionProperties.",
    "- Do not use alternative keys such as metadata, participants, uncertainties, description, removedSegments, generatedAt, inputHash, or contractVersion at the top level.",
    "- Do not include a markdown key. Markdown is rendered by the Dirong app from this structured JSON.",
    "- The app validates this output. Do not add keys that are not present in the skeleton or schema.",
    "- sourceTimeline must be an object with contractVersion, inputHash, entryCount.",
    "- meetingTitle must be { text, confidence, references }.",
    "- summary must be { text, references }.",
    "- Every topic must be { id, title, summary, references }.",
    "- Every decision must be { id, title, detail, status, references }.",
    "- decision.status must be exactly \"decided\" or \"tentative\". Never write \"uncertain\", \"unspecified\", \"pending\", or any other value.",
    "- If a decision-like item is too uncertain for decided/tentative, put it in unresolvedItems instead of decisions.",
    "- Every action item must be { id, task, owner, dueDate, references }.",
    "- actionItem.owner must be an object, never a string. Use { status: \"unspecified\", name: null, userId: null, evidence: [] } when no owner is explicitly supported.",
    "- actionItem.dueDate must be an object, never a string. Use { status: \"unspecified\", rawText: null, isoDate: null, evidence: [] } when no due date is explicitly supported.",
    "- For explicit owners, owner.evidence must contain the exact source references that support the owner.",
    "- For explicit due dates, dueDate.rawText must be an exact substring from the referenced transcript text, and dueDate.evidence must contain that source reference.",
    "- Do not use guessed due dates such as 즉시 or immediately unless the transcript literally says that text.",
    "- Every unresolved item must be { id, text, reason, references }.",
    "- Every uncertainty note must be { id, text, references }.",
    "- noiseHandling must be { removedChatterSummary, keptBecause }.",
    "- notionProperties must be an object. If no Notion custom property applies, use {}.",
    "- Each notionProperties value must be { values: string[] }.",
    `- language must be exactly "${locale}".`,
    "- Preserve exact chunkId, sttJobId, startMs, endMs, and speaker in references.",
    "- Do not include Notion operations, Notion tokens, Notion API instructions, or any instruction to write to Notion.",
    "- If owner, due date, or decision status is not directly supported by the transcript, do not invent it.",
    "- If owner or due date is not directly supported by the transcript, use unspecified.",
    "- For relative dates, set isoDate to null.",
    "",
    "Required skeleton:",
    JSON.stringify({
      schemaVersion: "dirong.meeting_notes_draft.v1",
      language: locale,
      sessionId: input.timeline.sessionId,
      sourceTimeline: {
        contractVersion: input.timeline.contractVersion,
        inputHash: input.inputHash,
        entryCount: input.timeline.entries.length,
      },
      meetingTitle: {
        text: skeletonText.title,
        confidence: "low",
        references: [],
      },
      summary: {
        text: skeletonText.summary,
        references: [],
      },
      topics: [],
      decisions: [],
      actionItems: [],
      unresolvedItems: [],
      uncertaintyNotes: [],
      noiseHandling: {
        removedChatterSummary: skeletonText.none,
        keptBecause: [],
      },
      notionProperties: {},
    }),
    ...(notionCustomPropertyPrompt
      ? [
          "",
          "Notion custom property extraction:",
          notionCustomPropertyPrompt,
        ]
      : []),
    ...(memberRosterPrompt
      ? [
          "",
          "Member roster assignment hints:",
          memberRosterPrompt,
        ]
      : []),
    "",
    "Canonical transcript timeline JSON:",
    input.canonicalJson,
    "",
    "Human-readable transcript timeline:",
    input.markdown,
  ].join("\n");
}

export function buildPhase4RepairPrompt(input: {
  timelineInput: Phase4TimelineInput;
  validationIssues: readonly string[];
  previousResponse: string;
  language?: DirongLocale;
}): string {
  const locale = input.language ?? DEFAULT_DIRONG_LOCALE;
  const languageName = meetingNotesLanguageName(locale);
  return [
    "Task: Repair the previous meeting-notes draft output so it matches the schema.",
    "",
    "You must keep exactly the same meeting content and source grounding as the previous response.",
    "Only fix JSON shape, missing required fields, invalid enum values, unsupported extra keys, and validation errors.",
    "",
    "Output contract:",
    "- Return a single raw JSON object, or one fenced json block containing only that object.",
    "- Do not include prose before or after the JSON.",
    "- Do not add arbitrary keys. The app validates every key.",
    "- Do not add a markdown key. The app renders Markdown after validation.",
    "- Keep notionProperties as an object whose values are { values: string[] }.",
    `- Keep every user-facing draft string in ${languageName}.`,
    `- The top-level language field must be exactly "${locale}".`,
    "- Do not write to Notion, call Notion APIs, include Notion tokens, or give Notion instructions.",
    "- Do not invent owners, dates, decisions, or facts while repairing.",
    "- If an owner, date, or decision is uncertain after repair, use unspecified fields or move it to unresolvedItems instead of inventing a status.",
    "- Exact unspecified owner object: { \"status\": \"unspecified\", \"name\": null, \"userId\": null, \"evidence\": [] }.",
    "- Exact unspecified dueDate object: { \"status\": \"unspecified\", \"rawText\": null, \"isoDate\": null, \"evidence\": [] }.",
    "- Never use owner as a string. Never omit owner.userId, owner.evidence, dueDate.rawText, dueDate.isoDate, or dueDate.evidence.",
    "- For explicit dueDate, rawText must be present verbatim in one allowed reference. If not, use the exact unspecified dueDate object.",
    "",
    "Required immutable context:",
    `- schemaVersion: dirong.meeting_notes_draft.v1`,
    `- language: ${locale}`,
    `- sessionId: ${input.timelineInput.timeline.sessionId}`,
    `- sourceTimeline.contractVersion: ${input.timelineInput.timeline.contractVersion}`,
    `- sourceTimeline.inputHash: ${input.timelineInput.inputHash}`,
    `- sourceTimeline.entryCount: ${input.timelineInput.timeline.entries.length}`,
    "",
    "Allowed reference facts:",
    JSON.stringify(
      input.timelineInput.timeline.entries.map((entry) => ({
        chunkId: entry.chunkId,
        sttJobId: entry.sttJobId,
        startMs: entry.startMs,
        endMs: entry.endMs,
        speaker: entry.displayNameSnapshot,
      })),
    ),
    "",
    "Validation errors to fix:",
    ...input.validationIssues.map((issue) => `- ${issue}`),
    "",
    "Previous response:",
    input.previousResponse,
  ].join("\n");
}

function meetingNotesLanguageName(locale: DirongLocale): string {
  return locale === "en" ? "English" : "Korean";
}

function meetingNotesSkeletonText(locale: DirongLocale): {
  title: string;
  summary: string;
  none: string;
} {
  if (locale === "en") {
    return {
      title: "Meeting notes draft",
      summary: "Summary",
      none: "None",
    };
  }
  return {
    title: "회의록 초안",
    summary: "요약",
    none: "없음",
  };
}
