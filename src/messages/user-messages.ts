import { safeErrorInfo, toLocalizedErrorMessage } from "../errors.js";
import { formatLocaleText, t } from "../i18n/catalog.js";
import type { DirongLocale } from "../settings/local-settings-store.js";

export function formatUserFacingError(
  error: unknown,
  locale: DirongLocale = "ko",
): string {
  const info = safeErrorInfo(error);
  const code = String(info.code ?? "");
  const message = info.message.toLowerCase();

  if (code === "DASHBOARD_PORT_IN_USE") {
    return info.message;
  }

  if (code === "EADDRINUSE" || message.includes("eaddrinuse")) {
    const endpoint =
      /(\d{1,3}(?:\.\d{1,3}){3}:\d+)/.exec(info.message)?.[1] ??
      t(locale, "error.userFacing.dashboardPortDefaultEndpoint");
    return formatLocaleText(locale, "error.userFacing.dashboardPortInUse", {
      endpoint,
    });
  }

  if (code === "LOCAL_WHISPER_PREFLIGHT_FAILED") {
    return t(locale, "error.userFacing.localWhisperPreflight");
  }

  if (code === "SQLITE_BACKUP_FAILED") {
    return t(locale, "error.userFacing.sqliteBackup");
  }

  if (
    message.includes("local-whisper") ||
    message.includes("faster-whisper") ||
    message.includes("whisper")
  ) {
    return t(locale, "error.userFacing.sttPreparation");
  }

  return toLocalizedErrorMessage(error, locale);
}

export function formatDebugHint(locale: DirongLocale = "ko"): string {
  return t(locale, "error.common.debugHint");
}
