import { t } from "../i18n/catalog.js";
import type { DirongLocale } from "../settings/local-settings-store.js";

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
  requestTimeoutMs: number;
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

export type NotionRuntimeSettingsProvider = () => NotionRuntimeSettings;

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
export const DEFAULT_NOTION_REQUEST_TIMEOUT_MS = 30000;

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
  locale: DirongLocale = "ko",
): NotionSettingsValidation {
  if (!settings.enabled) {
    return { ok: true };
  }

  const missingKeys = [
    settings.apiKey ? null : "notion.token",
  ].filter((key): key is string => key !== null);

  if (missingKeys.length === 0) {
    return { ok: true };
  }

  return {
    ok: false,
    missingKeys,
    userAction: t(locale, "notionWriter.apiKeyMissingAction"),
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
