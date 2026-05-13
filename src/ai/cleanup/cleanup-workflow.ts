import { summarizeSafeText } from "../../errors.js";
import type {
  AiCleanupFailureKind,
  AiCleanupJobRow,
} from "../../storage/rows.js";
import {
  DraftParseError,
  DraftValidationError,
} from "./draft.js";
import { AiCleanupProviderError } from "./provider.js";
import type {
  AiCleanupRunOptions,
  AiCleanupRunResult,
} from "./runner.js";
import type { Phase4TimelineInput } from "./timeline-input.js";

export function makeBaseResult(
  options: AiCleanupRunOptions,
  input: Phase4TimelineInput,
  inputChars: number,
): AiCleanupRunResult {
  return {
    workerId: options.workerId,
    dryRun: options.dryRun,
    sessionId: options.sessionId,
    provider: options.provider.providerName,
    model: options.provider.modelName,
    status: "dry_run",
    dbChanged: false,
    inputHash: input.inputHash,
    inputEntryCount: input.timeline.entries.length,
    inputChars,
    maxInputChars: options.maxInputChars,
    timelineMarkdownPreview: input.markdown.split("\n").slice(0, 5),
    backupPaths: [],
    job: null,
    draft: null,
    error: null,
  };
}

export function getInputBlockedReason(
  input: Phase4TimelineInput,
  inputChars: number,
  options: AiCleanupRunOptions,
): { kind: AiCleanupFailureKind; message: string } | null {
  if (
    options.includeFakeStt &&
    !options.dryRun &&
    options.provider.providerName !== "fake"
  ) {
    return {
      kind: "unsafe_input",
      message: [
        "fake STT는 실제 AI cleanup provider로 보낼 수 없습니다.",
        "일반 회의록 생성에서는 Phase 3 Real STT 결과만 사용해 주세요.",
        "fake STT 검증은 dry-run 또는 --provider fake --smoke-test 경로에서만 허용됩니다.",
      ].join(" "),
    };
  }

  if (input.timeline.entries.length === 0) {
    return {
      kind: "empty_timeline",
      message: [
        "회의록으로 보낼 실제 STT 발화가 아직 없습니다.",
        "Phase 3 Real STT를 먼저 실행해 주세요.",
        "no_speech와 fake STT는 기본 Phase 4 입력에서 제외됩니다.",
        "테스트 목적이면 dry-run에서 --include-fake-stt를 사용하거나,",
        "명시적 smoke test로 --provider fake --smoke-test --include-fake-stt를 사용해 주세요.",
      ].join(" "),
    };
  }
  if (inputChars > options.maxInputChars) {
    return {
      kind: "input_too_long",
      message: `회의 transcript가 Phase 4 MVP single-pass 한도를 초과했습니다. input=${inputChars}, max=${options.maxInputChars}. 긴 회의 map-reduce 요약은 Phase 4.1 이후 범위입니다.`,
    };
  }
  return null;
}

export function failedResult(
  baseResult: AiCleanupRunResult,
  backupPaths: string[],
  job: AiCleanupJobRow | null,
  error: string,
): AiCleanupRunResult {
  return {
    ...baseResult,
    status: "failed",
    dbChanged: true,
    backupPaths,
    job,
    error,
  };
}

export function providerFailureKind(error: unknown): AiCleanupFailureKind {
  if (error instanceof AiCleanupProviderError) {
    return error.failureKind;
  }
  return "unknown";
}

export function summarizeAiCleanupError(error: unknown): string {
  const message =
    error instanceof DraftValidationError
      ? error.issues.join("; ")
      : error instanceof DraftParseError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
  return summarizeSafeText(message);
}
