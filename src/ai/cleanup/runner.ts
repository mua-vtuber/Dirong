import { DirongError, summarizeSafeText } from "../../errors.js";
import {
  DEFAULT_DIRONG_LOCALE,
  type DirongLocale,
} from "../../settings/local-settings-store.js";
import { resolveAppLocale } from "../../i18n/app-locale.js";
import type {
  AiCleanupFailureKind,
  AiCleanupJobRow,
  MeetingNotesDraftRow,
} from "../../storage/rows.js";
import {
  DraftParseError,
  DraftValidationError,
  MEETING_NOTES_DRAFT_JSON_SCHEMA,
  MEETING_NOTES_DRAFT_SCHEMA_VERSION,
  parseMeetingNotesDraftFromRawText,
  validateMeetingNotesDraftV1,
} from "./draft.js";
import { renderMeetingNotesDraftMarkdown } from "./markdown-renderer.js";
import {
  makeAiCleanupJobId,
  makeArtifactPaths,
  writeTextAtomic,
} from "./artifact-store.js";
import {
  failedResult,
  getInputBlockedReason,
  makeBaseResult,
  providerFailureKind,
  summarizeAiCleanupError as summarizeError,
} from "./cleanup-workflow.js";
import type {
  AiCleanupProvider,
  AiCleanupProviderInput,
  AiCleanupProviderResetReason,
} from "./provider.js";
import { AiCleanupProviderError } from "./provider.js";
import { toLegacyResetReason } from "./provider-lifecycle.js";
import {
  PHASE4_AI_CLEANUP_PROMPT_VERSION,
  buildPhase4RepairPrompt,
  buildPhase4SystemPrompt,
  buildPhase4UserPrompt,
} from "./prompts.js";
import {
  makeAiCleanupProgressContext,
  safeEmitAiCleanupProgress,
  type AiCleanupProgressContext,
  type AiCleanupProgressObserver,
  type AiCleanupProgressUpdate,
} from "./progress.js";
import { summarizeSchemaRepairFailure } from "./repair-workflow.js";
import {
  buildPhase4TimelineInput,
  sha256Text,
  stableStringify,
} from "./timeline-input.js";
import type { AiCleanupRunStore } from "./storage-port.js";

export type AiCleanupRunResult = {
  workerId: string;
  dryRun: boolean;
  sessionId: string;
  provider: string;
  model: string;
  status:
    | "dry_run"
    | "done"
    | "already_done"
    | "blocked"
    | "failed"
    | "not_claimed";
  dbChanged: boolean;
  inputHash: string;
  inputEntryCount: number;
  inputChars: number;
  maxInputChars: number;
  timelineMarkdownPreview: string[];
  backupPaths: string[];
  job: AiCleanupJobRow | null;
  draft: MeetingNotesDraftRow | null;
  error: string | null;
};

export type AiCleanupRunOptions = {
  sessionId: string;
  dryRun: boolean;
  provider: AiCleanupProvider;
  workerId: string;
  leaseMs: number;
  maxAttempts: number;
  maxInputChars: number;
  timeoutMs: number;
  maxOutputBytes: number;
  locale?: DirongLocale;
  includeFakeStt?: boolean;
  customNotionPropertyPrompt?: (context: AiCleanupSessionContext) => string;
  memberRosterPrompt?: (context: AiCleanupSessionContext) => string;
  backup?: () => string[];
  progress?: AiCleanupProgressObserver;
};

export type AiCleanupSessionContext = {
  sessionId: string;
  projectId: string | null;
};

export async function runAiCleanupForSession(
  store: AiCleanupRunStore,
  options: AiCleanupRunOptions,
): Promise<AiCleanupRunResult> {
  let resetReason: AiCleanupProviderResetReason = "request_success";
  try {
    const result = await runAiCleanupForSessionCore(store, options);
    resetReason = resetReasonForRunResult(result);
    return result;
  } catch (error) {
    resetReason = resetReasonForThrownError(error);
    throw error;
  } finally {
    await resetProviderAfterRun(options.provider, resetReason);
  }
}

async function runAiCleanupForSessionCore(
  store: AiCleanupRunStore,
  options: AiCleanupRunOptions,
): Promise<AiCleanupRunResult> {
  const locale = resolveAppLocale({ locale: options.locale });
  const session = store.getSession(options.sessionId);
  if (!session) {
    throw new DirongError(
      "PHASE4_SESSION_NOT_FOUND",
      `AI cleanup 대상 세션을 찾지 못했습니다: ${options.sessionId}`,
    );
  }
  if (session.status !== "finalized") {
    throw new DirongError(
      "PHASE4_SESSION_NOT_FINALIZED",
      `Phase 4 AI cleanup은 finalized 세션만 처리합니다. 현재 세션 상태: ${session.status}`,
    );
  }

  const baseTimelineInput = buildPhase4TimelineInput(store, {
    sessionId: options.sessionId,
    includeFakeStt: options.includeFakeStt ?? false,
  });
  const sessionContext: AiCleanupSessionContext = {
    sessionId: session.id,
    projectId: session.project_id,
  };
  const systemPrompt = buildPhase4SystemPrompt(locale);
  const notionCustomPropertyPrompt =
    options.customNotionPropertyPrompt?.(sessionContext) ?? "";
  const memberRosterPrompt =
    options.memberRosterPrompt?.(sessionContext) ?? "";
  const timelineInput = {
    ...baseTimelineInput,
    inputHash: buildPhase4ContextualInputHash(baseTimelineInput.inputHash, {
      notionCustomPropertyPrompt,
      memberRosterPrompt,
      locale,
    }),
  };
  const userPrompt = buildPhase4UserPrompt(timelineInput, {
    notionCustomPropertyPrompt,
    memberRosterPrompt,
    locale,
  });
  const inputChars = timelineInput.canonicalJson.length + timelineInput.markdown.length;
  let progressContext = makeAiCleanupProgressContext({
    sessionId: options.sessionId,
    provider: options.provider.providerName,
    model: options.provider.modelName,
  });
  const emitProgress = (update: AiCleanupProgressUpdate): void => {
    safeEmitAiCleanupProgress(options.progress, progressContext, update);
  };
  const updateProgressContext = (
    patch: Partial<AiCleanupProgressContext>,
  ): void => {
    progressContext = { ...progressContext, ...patch };
  };

  emitProgress({
    phase: "preparing_input",
    message: "AI cleanup 입력 준비 중",
  });

  const baseResult = makeBaseResult(options, timelineInput, inputChars);
  if (options.dryRun) {
    return {
      ...baseResult,
      status: "dry_run",
      dbChanged: false,
    };
  }

  const artifactPaths = makeArtifactPaths({
    sessionDataDir: session.data_dir,
    provider: options.provider.providerName,
    model: options.provider.modelName,
    inputHash: timelineInput.inputHash,
    jobId: makeAiCleanupJobId({
      sessionId: options.sessionId,
      provider: options.provider.providerName,
      model: options.provider.modelName,
      promptVersion: PHASE4_AI_CLEANUP_PROMPT_VERSION,
      inputHash: timelineInput.inputHash,
    }),
  });
  updateProgressContext({ jobId: artifactPaths.jobId });
  emitProgress({
    phase: "claiming_job",
    message: "AI cleanup job 확인 중",
    jobId: artifactPaths.jobId,
  });

  const blockedReason = getInputBlockedReason(timelineInput, inputChars, options);
  if (!blockedReason) {
    await options.provider.preflight?.();
  }

  const backupPaths = options.backup?.() ?? [];
  writeTextAtomic(artifactPaths.inputJsonPath, `${timelineInput.canonicalJson}\n`);
  writeTextAtomic(artifactPaths.inputMarkdownPath, `${timelineInput.markdown}\n`);

  const job = store.getOrCreateAiCleanupJob({
    id: artifactPaths.jobId,
    sessionId: options.sessionId,
    provider: options.provider.providerName,
    model: options.provider.modelName,
    command: null,
    promptVersion: PHASE4_AI_CLEANUP_PROMPT_VERSION,
    inputContractVersion: timelineInput.timeline.contractVersion,
    inputHash: timelineInput.inputHash,
    inputEntryCount: timelineInput.timeline.entries.length,
    inputTimelineJsonPath: artifactPaths.inputJsonPath,
    inputTimelineMarkdownPath: artifactPaths.inputMarkdownPath,
    maxAttempts: options.maxAttempts,
  });

  if (job.status === "done") {
    emitProgress({
      phase: "completed",
      message: "이미 회의록 초안이 있습니다.",
      jobId: job.id,
      attempt: job.attempts,
    });
    return {
      ...baseResult,
      status: "already_done",
      dbChanged: false,
      backupPaths,
      job,
      draft: store.getMeetingNotesDraftByJobId(job.id),
    };
  }

  if (blockedReason) {
    store.blockAiCleanupJob({
      jobId: job.id,
      failureKind: blockedReason.kind,
      error: blockedReason.message,
    });
    emitProgress({
      phase: "failed",
      message: "회의록 생성 보류",
      jobId: job.id,
      attempt: job.attempts,
      warning: blockedReason.message,
    });
    return {
      ...baseResult,
      status: "blocked",
      dbChanged: true,
      backupPaths,
      job: store.getAiCleanupJob(job.id),
      error: blockedReason.message,
    };
  }

  store.releaseExpiredAiCleanupLeases();
  const claimed = store.claimAiCleanupJob({
    jobId: job.id,
    workerId: options.workerId,
    leaseMs: options.leaseMs,
  });
  if (!claimed) {
    emitProgress({
      phase: "failed",
      message: "AI cleanup job을 아직 실행할 수 없습니다.",
      jobId: job.id,
      attempt: job.attempts,
    });
    return {
      ...baseResult,
      status: "not_claimed",
      dbChanged: false,
      backupPaths,
      job: store.getAiCleanupJob(job.id),
      error: "AI cleanup job을 claim하지 못했습니다. 이미 처리 중이거나 재시도 시간이 아직 오지 않았습니다.",
    };
  }
  updateProgressContext({ jobId: claimed.id, attempt: claimed.attempts });

  try {
    emitProgress({
      phase: "writing_prompt_artifacts",
      message: "AI cleanup prompt artifact 저장 중",
      jobId: claimed.id,
      attempt: claimed.attempts,
    });
    writeTextAtomic(artifactPaths.promptPath, `${userPrompt}\n`);
    store.updateAiCleanupJobArtifacts({
      jobId: claimed.id,
      promptPath: artifactPaths.promptPath,
    });
  } catch (error) {
    const message = summarizeError(error);
    store.failProcessingAiCleanupJob({
      jobId: claimed.id,
      failureKind: "file_io",
      error: message,
    });
    emitProgress({
      phase: "failed",
      message: "AI cleanup artifact 저장 실패",
      jobId: claimed.id,
      attempt: claimed.attempts,
      warning: message,
    });
    return failedResult(baseResult, backupPaths, store.getAiCleanupJob(claimed.id), message);
  }

  const providerInput: AiCleanupProviderInput = {
    sessionId: options.sessionId,
    language: locale,
    promptVersion: PHASE4_AI_CLEANUP_PROMPT_VERSION,
    outputSchemaVersion: MEETING_NOTES_DRAFT_SCHEMA_VERSION,
    timeline: timelineInput.timeline,
    timelineMarkdown: timelineInput.markdown,
    inputHash: timelineInput.inputHash,
  };

  let providerResult;
  try {
    emitProgress({
      phase: "starting_claude",
      message: "Claude stream-json 요청 시작",
      jobId: claimed.id,
      attempt: claimed.attempts,
    });
    providerResult = await options.provider.generate(
      providerInput,
      {
        timeoutMs: options.timeoutMs,
        maxOutputBytes: options.maxOutputBytes,
        systemPrompt,
        userPrompt,
        jsonSchema: MEETING_NOTES_DRAFT_JSON_SCHEMA,
        progress: options.progress,
        progressContext,
      },
    );
  } catch (error) {
    const failureKind = providerFailureKind(error);
    const message = summarizeError(error);
    store.failProcessingAiCleanupJob({
      jobId: claimed.id,
      failureKind,
      error: message,
    });
    emitProgress({
      phase: "failed",
      message: "Claude stream-json 요청 실패",
      jobId: claimed.id,
      attempt: claimed.attempts,
      warning: message,
    });
    return failedResult(baseResult, backupPaths, store.getAiCleanupJob(claimed.id), message);
  }

  emitProgress({
    phase: "writing_raw_artifacts",
    message: "Claude raw output artifact 저장 중",
    jobId: claimed.id,
    attempt: claimed.attempts,
  });
  writeTextAtomic(artifactPaths.rawOutputPath, providerResult.rawText);
  writeTextAtomic(artifactPaths.stderrPath, providerResult.stderrText);
  store.updateAiCleanupJobArtifacts({
    jobId: claimed.id,
    command: providerResult.commandDisplay,
    rawOutputPath: artifactPaths.rawOutputPath,
    stderrPath: artifactPaths.stderrPath,
  });

  if (providerResult.exitCode !== 0) {
    const failureKind: AiCleanupFailureKind =
      providerResult.exitCode === null ? "provider_timeout" : "provider_nonzero_exit";
    const message = summarizeSafeText(
      providerResult.stderrText || `provider exit code: ${providerResult.exitCode}`,
    );
    store.failProcessingAiCleanupJob({
      jobId: claimed.id,
      failureKind,
      error: message,
    });
    emitProgress({
      phase: "failed",
      message: "Claude stream-json 요청 실패",
      jobId: claimed.id,
      attempt: claimed.attempts,
      warning: message,
    });
    return failedResult(baseResult, backupPaths, store.getAiCleanupJob(claimed.id), message);
  }

  if (providerResult.rawText.trim().length === 0) {
    const message = "Claude CLI returned empty output.";
    store.failProcessingAiCleanupJob({
      jobId: claimed.id,
      failureKind: "empty_output",
      error: message,
    });
    emitProgress({
      phase: "failed",
      message: "Claude output이 비어 있습니다.",
      jobId: claimed.id,
      attempt: claimed.attempts,
      warning: message,
    });
    return failedResult(baseResult, backupPaths, store.getAiCleanupJob(claimed.id), message);
  }

  let parsedDraft: unknown;
  try {
    emitProgress({
      phase: "parsing_json",
      message: "회의록 JSON 파싱 중",
      jobId: claimed.id,
      attempt: claimed.attempts,
    });
    parsedDraft = parseMeetingNotesDraftFromRawText(providerResult.rawText);
  } catch (error) {
    const message = summarizeError(error);
    store.failProcessingAiCleanupJob({
      jobId: claimed.id,
      failureKind: "malformed_json",
      error: message,
    });
    emitProgress({
      phase: "failed",
      message: "회의록 JSON 파싱 실패",
      jobId: claimed.id,
      attempt: claimed.attempts,
      warning: message,
    });
    return failedResult(baseResult, backupPaths, store.getAiCleanupJob(claimed.id), message);
  }

  let draft;
  let draftRawOutputPath = artifactPaths.rawOutputPath;
  try {
    emitProgress({
      phase: "validating_schema",
      message: "회의록 schema 검증 중",
      jobId: claimed.id,
      attempt: claimed.attempts,
    });
    draft = validateMeetingNotesDraftV1(parsedDraft, {
      sessionId: options.sessionId,
      inputHash: timelineInput.inputHash,
      timeline: timelineInput.timeline,
      language: locale,
    });
  } catch (error) {
    const validationIssues =
      error instanceof DraftValidationError ? error.issues : [summarizeError(error)];
    const repairPrompt = buildPhase4RepairPrompt({
      timelineInput,
      validationIssues,
      previousResponse: providerResult.rawText,
      language: locale,
    });
    writeTextAtomic(artifactPaths.repairPromptPath, `${repairPrompt}\n`);
    await resetProviderSession(options.provider, "before_repair");
    const repairProgressContext = {
      ...progressContext,
      repairAttempt: true,
    };
    emitProgress({
      phase: "repairing_schema",
      message: "회의록 schema repair 요청 중",
      jobId: claimed.id,
      attempt: claimed.attempts,
      repairAttempt: true,
    });

    let repairResult;
    try {
      repairResult = await options.provider.generate(providerInput, {
        timeoutMs: options.timeoutMs,
        maxOutputBytes: options.maxOutputBytes,
        systemPrompt,
        userPrompt: repairPrompt,
        jsonSchema: MEETING_NOTES_DRAFT_JSON_SCHEMA,
        progress: options.progress,
        progressContext: repairProgressContext,
      });
    } catch (repairError) {
      const failureKind = providerFailureKind(repairError);
      const message = summarizeError(repairError);
      store.failProcessingAiCleanupJob({
        jobId: claimed.id,
        failureKind,
        error: message,
      });
      emitProgress({
        phase: "failed",
        message: "회의록 schema repair 요청 실패",
        jobId: claimed.id,
        attempt: claimed.attempts,
        repairAttempt: true,
        warning: message,
      });
      return failedResult(baseResult, backupPaths, store.getAiCleanupJob(claimed.id), message);
    }

    emitProgress({
      phase: "writing_raw_artifacts",
      message: "Claude repair raw output artifact 저장 중",
      jobId: claimed.id,
      attempt: claimed.attempts,
      repairAttempt: true,
    });
    writeTextAtomic(artifactPaths.repairRawOutputPath, repairResult.rawText);
    writeTextAtomic(artifactPaths.repairStderrPath, repairResult.stderrText);
    store.updateAiCleanupJobArtifacts({
      jobId: claimed.id,
      command: repairResult.commandDisplay,
      rawOutputPath: artifactPaths.repairRawOutputPath,
      stderrPath: artifactPaths.repairStderrPath,
    });

    if (repairResult.exitCode !== 0) {
      const failureKind: AiCleanupFailureKind =
        repairResult.exitCode === null ? "provider_timeout" : "provider_nonzero_exit";
      const message = summarizeSafeText(
        repairResult.stderrText || `provider repair exit code: ${repairResult.exitCode}`,
      );
      store.failProcessingAiCleanupJob({
        jobId: claimed.id,
        failureKind,
        error: message,
      });
      emitProgress({
        phase: "failed",
        message: "회의록 schema repair 실패",
        jobId: claimed.id,
        attempt: claimed.attempts,
        repairAttempt: true,
        warning: message,
      });
      return failedResult(baseResult, backupPaths, store.getAiCleanupJob(claimed.id), message);
    }

    try {
      emitProgress({
        phase: "validating_schema",
        message: "repair 결과 schema 검증 중",
        jobId: claimed.id,
        attempt: claimed.attempts,
        repairAttempt: true,
      });
      if (repairResult.rawText.trim().length === 0) {
        throw new DraftParseError("provider repair output is empty");
      }
      const repairedDraft = parseMeetingNotesDraftFromRawText(repairResult.rawText);
      draft = validateMeetingNotesDraftV1(repairedDraft, {
        sessionId: options.sessionId,
        inputHash: timelineInput.inputHash,
        timeline: timelineInput.timeline,
        language: locale,
      });
      draftRawOutputPath = artifactPaths.repairRawOutputPath;
    } catch (repairError) {
      const message = summarizeSchemaRepairFailure(validationIssues, repairError);
      store.failProcessingAiCleanupJob({
        jobId: claimed.id,
        failureKind: "schema_invalid",
        error: message,
      });
      emitProgress({
        phase: "failed",
        message: "repair 결과 schema 검증 실패",
        jobId: claimed.id,
        attempt: claimed.attempts,
        repairAttempt: true,
        warning: message,
      });
      return failedResult(baseResult, backupPaths, store.getAiCleanupJob(claimed.id), message);
    }
  }

  emitProgress({
    phase: "rendering_draft",
    message: "회의록 draft 저장 중",
    jobId: claimed.id,
    attempt: claimed.attempts,
  });
  const draftJson = stableStringify(draft);
  const draftMarkdown = renderMeetingNotesDraftMarkdown(draft, { locale });
  const outputHash = sha256Text(draftJson);
  writeTextAtomic(artifactPaths.draftJsonPath, `${draftJson}\n`);
  writeTextAtomic(artifactPaths.draftMarkdownPath, `${draftMarkdown}\n`);

  const savedDraft = store.completeAiCleanupJob({
    jobId: claimed.id,
    draftId: `draft_${claimed.id}`,
    schemaVersion: draft.schemaVersion,
    language: draft.language,
    title: draft.meetingTitle.text,
    summaryText: draft.summary.text,
    draftJson,
    markdown: draftMarkdown,
    jsonPath: artifactPaths.draftJsonPath,
    markdownPath: artifactPaths.draftMarkdownPath,
    rawOutputPath: draftRawOutputPath,
    provider: options.provider.providerName,
    model: options.provider.modelName,
    promptVersion: PHASE4_AI_CLEANUP_PROMPT_VERSION,
    inputHash: timelineInput.inputHash,
    outputHash,
  });
  emitProgress({
    phase: "completed",
    message: "회의록 초안 생성 완료",
    jobId: claimed.id,
    attempt: claimed.attempts,
  });

  return {
    ...baseResult,
    status: "done",
    dbChanged: true,
    backupPaths,
    job: store.getAiCleanupJob(claimed.id),
    draft: savedDraft,
  };
}

export function buildPhase4ContextualInputHash(
  baseInputHash: string,
  context: {
    notionCustomPropertyPrompt?: string;
    memberRosterPrompt?: string;
    locale?: DirongLocale;
  },
): string {
  const notionCustomPropertyPrompt =
    context.notionCustomPropertyPrompt?.trim() ?? "";
  const memberRosterPrompt = context.memberRosterPrompt?.trim() ?? "";
  const locale = context.locale ?? DEFAULT_DIRONG_LOCALE;
  if (
    !notionCustomPropertyPrompt &&
    !memberRosterPrompt &&
    locale === DEFAULT_DIRONG_LOCALE
  ) {
    return baseInputHash;
  }
  const hashInput: {
    baseInputHash: string;
    locale?: DirongLocale;
    notionCustomPropertyPromptHash?: string;
    memberRosterPromptHash?: string;
  } = { baseInputHash };
  if (locale !== DEFAULT_DIRONG_LOCALE) {
    hashInput.locale = locale;
  }
  if (notionCustomPropertyPrompt) {
    hashInput.notionCustomPropertyPromptHash = sha256Text(
      notionCustomPropertyPrompt,
    );
  }
  if (memberRosterPrompt) {
    hashInput.memberRosterPromptHash = sha256Text(memberRosterPrompt);
  }
  return sha256Text(stableStringify(hashInput));
}

async function resetProviderAfterRun(
  provider: AiCleanupProvider,
  reason: AiCleanupProviderResetReason,
): Promise<void> {
  await resetProviderSession(provider, reason);
}

async function resetProviderSession(
  provider: AiCleanupProvider,
  reason: AiCleanupProviderResetReason,
): Promise<void> {
  try {
    if (provider.resetSession) {
      await provider.resetSession(reason);
      return;
    }
    await provider.resetAfterRequest?.(toLegacyResetReason(reason));
  } catch (error) {
    console.warn(
      `AI cleanup provider reset failed after ${reason}: ${summarizeError(error)}`,
    );
  }
}

function resetReasonForRunResult(
  result: AiCleanupRunResult,
): AiCleanupProviderResetReason {
  if (result.status !== "failed") {
    return "request_success";
  }
  return result.job?.failure_kind === "provider_timeout"
    ? "request_timeout"
    : "request_failure";
}

function resetReasonForThrownError(
  error: unknown,
): AiCleanupProviderResetReason {
  return error instanceof AiCleanupProviderError &&
    error.failureKind === "provider_timeout"
    ? "request_timeout"
    : "request_failure";
}
