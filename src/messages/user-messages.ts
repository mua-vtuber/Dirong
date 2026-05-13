import { safeErrorInfo, toLocalizedErrorMessage } from "../errors.js";
import { t } from "../i18n/catalog.js";
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
      "설정된 dashboard 포트";
    return [
      `디롱이 dashboard 포트를 이미 사용 중입니다: ${endpoint}`,
      "",
      "확인할 것:",
      "1. 이미 실행 중인 Dirong 콘솔이 있으면 그 창에서 exit를 입력해 종료해 주세요.",
      "2. 제품용 기본 포트는 3095입니다. 포트를 쓰는 다른 프로그램을 종료한 뒤 다시 시작해 주세요.",
    ].join("\n");
  }

  if (code === "LOCAL_WHISPER_PREFLIGHT_FAILED") {
    return [
      "디롱이 local-whisper 준비에 실패했습니다.",
      "",
      "확인할 것:",
      "1. .venv-whisper가 만들어져 있고 faster-whisper가 설치되어 있는지 확인해 주세요.",
      "2. 설정 마법사에 저장한 local-whisper 모델 경로가 실제 모델 폴더인지 확인해 주세요.",
      "3. Windows에서는 기본값인 cpu/int8 설정을 먼저 사용해 주세요.",
    ].join("\n");
  }

  if (code === "SQLITE_BACKUP_FAILED") {
    return [
      "디롱이 SQLite backup 생성에 실패했습니다.",
      "",
      "확인할 것:",
      "1. 녹음 중이면 잠시 후 다시 시도해 주세요.",
      "2. data 폴더를 다른 프로그램이 잠그고 있지 않은지 확인해 주세요.",
      "3. 디스크 여유 공간이 충분한지 확인해 주세요.",
      "",
      "backup이 실패했으므로 STT 처리는 시작하지 않았습니다.",
    ].join("\n");
  }

  if (
    message.includes("local-whisper") ||
    message.includes("faster-whisper") ||
    message.includes("whisper")
  ) {
    return [
      "디롱이 STT 준비 중 문제가 생겼습니다.",
      "",
      "확인할 것:",
      "1. local-whisper 설정과 Python 환경을 확인해 주세요.",
      "2. 모델 경로와 CPU/int8 설정을 먼저 확인해 주세요.",
    ].join("\n");
  }

  return toLocalizedErrorMessage(error, locale);
}

export function formatDebugHint(locale: DirongLocale = "ko"): string {
  return t(locale, "error.common.debugHint");
}
