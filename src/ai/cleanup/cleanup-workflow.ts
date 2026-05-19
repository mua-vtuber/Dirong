import { summarizeSafeText } from "../../errors.js";
import { formatLocaleText, t } from "../../i18n/catalog.js";
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
      message: t("ko", "runtimeCli.aiWorkflow.fakeSttUnsafe"),
    };
  }

  if (input.timeline.entries.length === 0) {
    return {
      kind: "empty_timeline",
      message: t("ko", "runtimeCli.aiWorkflow.emptyTimeline"),
    };
  }
  if (inputChars > options.maxInputChars) {
    return {
      kind: "input_too_long",
      message: formatLocaleText("ko", "runtimeCli.aiWorkflow.inputTooLong", {
        inputChars,
        maxInputChars: options.maxInputChars,
      }),
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
