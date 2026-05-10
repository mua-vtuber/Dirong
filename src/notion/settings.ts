export type NotionUploadMode = "manual" | "automatic_after_ai_cleanup";
export type NotionTemplateType = "app";
export type NotionIncludeTranscript = "never";
export type NotionTargetType = "data_source";

export type NotionPropertyNames = {
  title: string;
  date: string;
  meetingTime: string;
  channel: string;
  participants: string;
  status: string;
  sessionId: string;
  draftId: string;
  contentHash: string;
  localStatus: string;
};

export type NotionRuntimeSettings = {
  enabled: boolean;
  apiKey: string | null;
  apiVersion: string;
  baseUrl: string;
  targetUrl: string | null;
  targetType: NotionTargetType;
  uploadMode: NotionUploadMode;
  templateType: NotionTemplateType;
  includeTranscript: NotionIncludeTranscript;
  autoPollMs: number;
  leaseMs: number;
  maxAttempts: number;
  propertyNames: NotionPropertyNames;
};

export type SafeNotionRuntimeSettingsSnapshot = Omit<
  NotionRuntimeSettings,
  "apiKey"
> & {
  apiKey: "[REDACTED]" | "[MISSING]";
};

export type NotionSettingsValidation =
  | { ok: true }
  | { ok: false; missingKeys: string[]; userAction: string };

export const DEFAULT_NOTION_API_VERSION = "2026-03-11";
export const DEFAULT_NOTION_BASE_URL = "https://api.notion.com";

export const DEFAULT_NOTION_PROPERTY_NAMES: NotionPropertyNames = {
  title: "Name",
  date: "Date",
  meetingTime: "Meeting Time",
  channel: "Channel",
  participants: "Participants",
  status: "Status",
  sessionId: "Session ID",
  draftId: "Draft ID",
  contentHash: "Dirong Content Hash",
  localStatus: "Local Status",
};

export function validateNotionRuntimeSettings(
  settings: NotionRuntimeSettings,
): NotionSettingsValidation {
  if (!settings.enabled) {
    return { ok: true };
  }

  const missingKeys = [
    settings.apiKey ? null : "NOTION_API_KEY",
  ].filter((key): key is string => key !== null);

  if (missingKeys.length === 0) {
    return { ok: true };
  }

  return {
    ok: false,
    missingKeys,
    userAction:
      "Notion 업로드를 켜려면 .env에 NOTION_API_KEY를 설정해 주세요. managed DB registry가 없으면 NOTION_TARGET_URL도 필요합니다.",
  };
}

export function snapshotNotionRuntimeSettings(
  settings: NotionRuntimeSettings,
): SafeNotionRuntimeSettingsSnapshot {
  return {
    ...settings,
    apiKey: settings.apiKey ? "[REDACTED]" : "[MISSING]",
  };
}
