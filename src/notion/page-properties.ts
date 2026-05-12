import type { NotionDraftInput } from "./draft-input.js";
import type { NotionPropertySemanticKey } from "./schema-presets.js";
import type { NotionPropertyNames } from "./settings.js";

export type NotionPageStatus = "draft" | "done" | "retry_wait" | "failed";
export type NotionStatusPropertyType = "select" | "status";
export type NotionParticipantsPropertyType = "multi_select" | "rollup";

export const NOTION_PAGE_STATUS_VALUES = [
  "draft",
  "done",
  "retry_wait",
  "failed",
] as const satisfies readonly NotionPageStatus[];

export type NotionRichText = Array<{ text: { content: string } }>;

export type NotionPageProperties = Record<string, unknown>;

export type NotionPagePropertyValues = {
  title: string;
  date: string;
  meetingTime: string;
  channel: string;
  participants: string[];
  status: NotionPageStatus;
  sessionId: string;
  draftId: string;
  localStatus: string;
};

export type NotionPagePropertyRenderResult = {
  values: NotionPagePropertyValues;
  properties: NotionPageProperties;
  warnings: string[];
};

export type NotionSemanticPageProperty = {
  name: string;
  type: string;
};

export type NotionSemanticPageProperties = Partial<
  Record<NotionPropertySemanticKey, NotionSemanticPageProperty>
>;

export type NotionActionItemDraft =
  NotionDraftInput["draftContent"]["actionItems"][number];

export function buildNotionPagePropertyValues(input: {
  draftInput: NotionDraftInput;
  status?: NotionPageStatus;
  localStatus?: string;
}): { values: NotionPagePropertyValues; warnings: string[] } {
  const warnings: string[] = [];
  const session = input.draftInput.session;
  const participants = sanitizeParticipantNames(
    input.draftInput.speakers
      .filter((speaker) => speaker.is_bot === 0)
      .map((speaker) => speaker.display_name_snapshot),
    warnings,
  );

  return {
    values: {
      title:
        cleanInline(input.draftInput.draftContent.meetingTitle.text) ||
        "회의록 초안",
      date: formatLocalDate(session.started_at),
      meetingTime: formatMeetingTime(session.started_at, session.finalized_at),
      channel:
        cleanInline(session.voice_channel_name ?? "") ||
        cleanInline(session.voice_channel_id) ||
        "알 수 없음",
      participants,
      status: input.status ?? "draft",
      sessionId: session.id,
      draftId: input.draftInput.draft.id,
      localStatus: input.localStatus ?? "Notion upload pending",
    },
    warnings,
  };
}

export function renderNotionPageProperties(input: {
  draftInput: NotionDraftInput;
  propertyNames: NotionPropertyNames;
  contentHash: string;
  status?: NotionPageStatus;
  statusPropertyType?: NotionStatusPropertyType;
  participantsPropertyType?: NotionParticipantsPropertyType;
  localStatus?: string;
}): NotionPagePropertyRenderResult {
  const { values, warnings } = buildNotionPagePropertyValues({
    draftInput: input.draftInput,
    status: input.status,
    localStatus: input.localStatus,
  });
  const names = input.propertyNames;

  const properties: NotionPageProperties = {
    [names.title]: {
      title: [{ text: { content: values.title } }],
    },
    [names.date]: {
      date: { start: values.date },
    },
    [names.meetingTime]: {
      rich_text: richText(values.meetingTime),
    },
    [names.channel]: {
      rich_text: richText(values.channel),
    },
    [names.status]: renderStatusProperty(
      input.statusPropertyType ?? "select",
      values.status,
    ),
    [names.sessionId]: {
      rich_text: richText(values.sessionId),
    },
    [names.draftId]: {
      rich_text: richText(values.draftId),
    },
    [names.contentHash]: {
      rich_text: richText(input.contentHash),
    },
    [names.localStatus]: {
      rich_text: richText(values.localStatus),
    },
  };

  if ((input.participantsPropertyType ?? "multi_select") !== "rollup") {
    properties[names.participants] = {
      multi_select: values.participants.map((name) => ({ name })),
    };
  }

  return {
    values,
    warnings,
    properties,
  };
}

export function renderNotionPagePropertiesFromSemanticMappings(input: {
  draftInput: NotionDraftInput;
  propertiesBySemanticKey: NotionSemanticPageProperties;
  contentHash: string;
  memberRelationPageIds?: readonly string[];
  status?: NotionPageStatus;
  localStatus?: string;
}): NotionPagePropertyRenderResult {
  const propertyNames = propertyNamesFromSemanticMappings(
    input.propertiesBySemanticKey,
  );
  const rendered = renderNotionPageProperties({
    draftInput: input.draftInput,
    propertyNames,
    contentHash: input.contentHash,
    status: input.status,
    localStatus: input.localStatus,
    statusPropertyType: readStatusPropertyType(
      input.propertiesBySemanticKey["meeting.status"]?.type,
    ),
    participantsPropertyType: readParticipantsPropertyType(
      input.propertiesBySemanticKey["meeting.participants"]?.type,
    ),
  });

  const relationProperty =
    input.propertiesBySemanticKey["meeting.memberRelation"];
  const relationPageIds = [...(input.memberRelationPageIds ?? [])];
  if (relationProperty && relationPageIds.length > 0) {
    rendered.properties[relationProperty.name] = {
      relation: relationPageIds.slice(0, 100).map((id) => ({ id })),
    };
  }

  return rendered;
}

export function buildNotionTaskSourceActionId(input: {
  draftId: string;
  actionItemId: string;
}): string {
  return `${input.draftId}:${input.actionItemId}`;
}

export function renderNotionTaskPageProperties(input: {
  actionItem: NotionActionItemDraft;
  propertiesBySemanticKey: NotionSemanticPageProperties;
  meetingPageId: string;
  workerRelationPageId?: string | null;
  sourceActionId: string;
}): NotionPageProperties {
  const title = requireSemanticProperty(input.propertiesBySemanticKey, "task.title");
  const meeting = requireSemanticProperty(input.propertiesBySemanticKey, "task.meeting");
  const workerRelation = input.propertiesBySemanticKey["task.workerRelation"];
  const dueDate = requireSemanticProperty(input.propertiesBySemanticKey, "task.dueDate");
  const status = requireSemanticProperty(input.propertiesBySemanticKey, "task.status");
  const evidence = requireSemanticProperty(input.propertiesBySemanticKey, "task.evidence");
  const sourceActionId = requireSemanticProperty(
    input.propertiesBySemanticKey,
    "task.sourceActionId",
  );

  const properties: NotionPageProperties = {
    [title.name]: {
      title: [{ text: { content: cleanInline(input.actionItem.task) || "작업" } }],
    },
    [meeting.name]: {
      relation: [{ id: input.meetingPageId }],
    },
    [status.name]: renderTaskStatusProperty(status.type),
    [evidence.name]: {
      rich_text: richText(renderActionItemEvidence(input.actionItem)),
    },
    [sourceActionId.name]: {
      rich_text: richText(input.sourceActionId),
    },
  };

  if (input.actionItem.dueDate.status === "explicit" && input.actionItem.dueDate.isoDate) {
    properties[dueDate.name] = {
      date: { start: input.actionItem.dueDate.isoDate },
    };
  }
  if (workerRelation && input.workerRelationPageId) {
    properties[workerRelation.name] = {
      relation: [{ id: input.workerRelationPageId }],
    };
  }

  return properties;
}

function renderStatusProperty(
  propertyType: NotionStatusPropertyType,
  status: NotionPageStatus,
): unknown {
  if (propertyType === "status") {
    return { status: { name: status } };
  }
  return { select: { name: status } };
}

function propertyNamesFromSemanticMappings(
  propertiesBySemanticKey: NotionSemanticPageProperties,
): NotionPropertyNames {
  return {
    title: requireSemanticPropertyName(propertiesBySemanticKey, "meeting.title"),
    date: requireSemanticPropertyName(propertiesBySemanticKey, "meeting.date"),
    meetingTime: requireSemanticPropertyName(
      propertiesBySemanticKey,
      "meeting.time",
    ),
    channel: requireSemanticPropertyName(
      propertiesBySemanticKey,
      "meeting.channel",
    ),
    participants: requireSemanticPropertyName(
      propertiesBySemanticKey,
      "meeting.participants",
    ),
    status: requireSemanticPropertyName(
      propertiesBySemanticKey,
      "meeting.status",
    ),
    sessionId: requireSemanticPropertyName(
      propertiesBySemanticKey,
      "meeting.sessionId",
    ),
    draftId: requireSemanticPropertyName(
      propertiesBySemanticKey,
      "meeting.draftId",
    ),
    contentHash: requireSemanticPropertyName(
      propertiesBySemanticKey,
      "meeting.contentHash",
    ),
    localStatus: requireSemanticPropertyName(
      propertiesBySemanticKey,
      "meeting.localStatus",
    ),
  };
}

function requireSemanticPropertyName(
  propertiesBySemanticKey: NotionSemanticPageProperties,
  semanticKey: NotionPropertySemanticKey,
): string {
  return requireSemanticProperty(propertiesBySemanticKey, semanticKey).name;
}

function requireSemanticProperty(
  propertiesBySemanticKey: NotionSemanticPageProperties,
  semanticKey: NotionPropertySemanticKey,
): NotionSemanticPageProperty {
  const property = propertiesBySemanticKey[semanticKey];
  if (!property?.name) {
    throw new Error(`Notion semantic property mapping is missing: ${semanticKey}`);
  }
  return property;
}

function readStatusPropertyType(
  type: string | undefined,
): NotionStatusPropertyType {
  return type === "status" ? "status" : "select";
}

function readParticipantsPropertyType(
  type: string | undefined,
): NotionParticipantsPropertyType {
  return type === "rollup" ? "rollup" : "multi_select";
}

export function richText(content: string): NotionRichText {
  const cleaned = content.replace(/\r\n/g, "\n");
  if (cleaned.length === 0) {
    return [{ text: { content: "" } }];
  }

  const parts: NotionRichText = [];
  for (let index = 0; index < cleaned.length; index += 2000) {
    parts.push({ text: { content: cleaned.slice(index, index + 2000) } });
  }
  return parts;
}

function renderTaskStatusProperty(propertyType: string): unknown {
  const name = "할 일";
  return propertyType === "status" ? { status: { name } } : { select: { name } };
}

function renderActionItemEvidence(actionItem: NotionActionItemDraft): string {
  const references = actionItem.references
    .map((reference) =>
      `${reference.speaker} ${formatReferenceTime(reference.startMs)}-${formatReferenceTime(reference.endMs)}`,
    )
    .join(", ");
  return references || "근거 없음";
}

function formatReferenceTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function sanitizeParticipantNames(
  names: readonly string[],
  warnings: string[] = [],
): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const rawName of names) {
    const name = cleanInline(rawName).replaceAll(",", " ").replace(/\s+/g, " ");
    if (!name) {
      warnings.push("빈 참여자 이름은 Notion Participants 속성에서 제외했습니다.");
      continue;
    }

    const key = name.toLocaleLowerCase("ko-KR");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(name);
    if (output.length === 100) {
      if (names.length > 100) {
        warnings.push("Notion Participants 속성은 최대 100명까지만 기록했습니다.");
      }
      break;
    }
  }

  return output;
}

export function formatMeetingTime(
  startedAtIso: string,
  finalizedAtIso: string | null,
): string {
  const start = new Date(startedAtIso);
  const end = finalizedAtIso ? new Date(finalizedAtIso) : null;
  if (!end || Number.isNaN(end.getTime()) || end.getTime() < start.getTime()) {
    return `${formatClock(start)}-미정`;
  }

  return `${formatClock(start)}-${formatClock(end)} (${formatDuration(
    end.getTime() - start.getTime(),
  )})`;
}

function formatLocalDate(iso: string): string {
  const date = new Date(iso);
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatClock(date: Date): string {
  return [
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
  ].join(":");
}

function formatDuration(durationMs: number): string {
  const totalMinutes = Math.max(0, Math.round(durationMs / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  return `${minutes}m`;
}

function cleanInline(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
