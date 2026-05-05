import {
  MissingRequiredConfigError,
  safeErrorInfo,
  toKoreanErrorMessage,
} from "../errors.js";

export function formatUserFacingError(error: unknown): string {
  if (error instanceof MissingRequiredConfigError) {
    return [
      ".env 설정이 아직 부족합니다.",
      `빠진 항목: ${error.missingKeys.join(", ")}`,
      ".env.example을 .env로 복사한 뒤 Discord 토큰과 ID를 채워 주세요.",
    ].join("\n");
  }

  const info = safeErrorInfo(error);
  const code = String(info.code ?? "");
  const message = info.message.toLowerCase();

  if (code === "LOCAL_WHISPER_PREFLIGHT_FAILED") {
    return [
      "디롱이 local-whisper 준비에 실패했습니다.",
      "",
      "확인할 것:",
      "1. .venv-whisper가 만들어져 있고 faster-whisper가 설치되어 있는지 확인해 주세요.",
      "2. PHASE3_LOCAL_WHISPER_MODEL 경로가 실제 모델 폴더인지 확인해 주세요.",
      "3. Windows에서는 기본값인 PHASE3_LOCAL_WHISPER_DEVICE=cpu, PHASE3_LOCAL_WHISPER_COMPUTE_TYPE=int8을 먼저 사용해 주세요.",
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

  return toKoreanErrorMessage(error);
}

export function formatDebugHint(): string {
  return "상세 정보가 필요하면 --debug 옵션 또는 DIRONG_DEBUG=true로 다시 실행해 주세요.";
}
