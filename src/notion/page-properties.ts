import type { NotionDraftInput } from "./draft-input.js";
import type { NotionPropertyNames } from "./settings.js";

export type NotionPageStatus = "draft" | "done" | "retry_wait" | "failed";
export type NotionStatusPropertyType = "select" | "status";

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
  localStatus?: string;
}): NotionPagePropertyRenderResult {
  const { values, warnings } = buildNotionPagePropertyValues({
    draftInput: input.draftInput,
    status: input.status,
    localStatus: input.localStatus,
  });
  const names = input.propertyNames;

  return {
    values,
    warnings,
    properties: {
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
      [names.participants]: {
        multi_select: values.participants.map((name) => ({ name })),
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
    },
  };
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
