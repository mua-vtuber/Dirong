import { t, type LocaleKey } from "../i18n/catalog.js";
import type { DirongLocale } from "../settings/local-settings-store.js";

export function formatSessionStatus(
  locale: DirongLocale,
  status: string,
): string {
  return `${t(locale, sessionStatusKey(status))} (${status})`;
}

export function sessionStatusKey(status: string): LocaleKey {
  if (status === "created") {
    return "runtimeStatus.recordingStatus.sessionStatus.created";
  }
  if (status === "active") {
    return "runtimeStatus.recordingStatus.sessionStatus.active";
  }
  if (status === "reconnecting") {
    return "runtimeStatus.recordingStatus.sessionStatus.reconnecting";
  }
  if (status === "stopping") {
    return "runtimeStatus.recordingStatus.sessionStatus.stopping";
  }
  if (status === "finalized") {
    return "runtimeStatus.recordingStatus.sessionStatus.finalized";
  }
  if (status === "failed") {
    return "runtimeStatus.recordingStatus.sessionStatus.failed";
  }
  if (status === "needs_repair") {
    return "runtimeStatus.recordingStatus.sessionStatus.needsRepair";
  }
  return "runtimeStatus.recordingStatus.sessionStatus.unknown";
}
