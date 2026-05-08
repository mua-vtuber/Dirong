import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DirongError, redactSensitiveText } from "../../errors.js";
import type {
  AiCleanupFailureKind,
  AiCleanupJobRow,
  MeetingNotesDraftRow,
  SessionStore,
} from "../../storage/session-store.js";
import {
  DraftParseError,
  DraftValidationError,
  MEETING_NOTES_DRAFT_JSON_SCHEMA,
  MEETING_NOTES_DRAFT_SCHEMA_VERSION,
  parseMeetingNotesDraftFromRawText,
  validateMeetingNotesDraftV1,
} from "./draft.js";
import { renderMeetingNotesDraftMarkdown } from "./markdown-renderer.js";
import type {
  AiCleanupProvider,
  AiCleanupProviderInput,
  AiCleanupProviderResetReason,
} from "./provider.js";
import { AiCleanupProviderError } from "./provider.js";
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
import {
  buildPhase4TimelineInput,
  sha256Text,
  stableStringify,
  type Phase4TimelineInput,
} from "./timeline-input.js";

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
  includeFakeStt?: boolean;
  customNotionPropertyPrompt?: () => string;
  backup?: () => string[];
  progress?: AiCleanupProgressObserver;
};

export async function runAiCleanupForSession(
  store: SessionStore,
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
  store: SessionStore,
  options: AiCleanupRunOptions,
): Promise<AiCleanupRunResult> {
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

  const timelineInput = buildPhase4TimelineInput(store, {
    sessionId: options.sessionId,
    includeFakeStt: options.includeFakeStt ?? false,
  });
  const systemPrompt = buildPhase4SystemPrompt();
  const notionCustomPropertyPrompt = options.customNotionPropertyPrompt?.() ?? "";
  const userPrompt = buildPhase4UserPrompt(timelineInput, {
    notionCustomPropertyPrompt,
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
    language: "ko",
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
    const message = redactSensitiveText(
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
    });
  } catch (error) {
    const validationIssues =
      error instanceof DraftValidationError ? error.issues : [summarizeError(error)];
    const repairPrompt = buildPhase4RepairPrompt({
      timelineInput,
      validationIssues,
      previousResponse: providerResult.rawText,
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
      const message = redactSensitiveText(
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
  const draftMarkdown = renderMeetingNotesDraftMarkdown(draft);
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

function toLegacyResetReason(
  reason: AiCleanupProviderResetReason,
): "success" | "failure" | "timeout" {
  if (reason === "request_timeout") {
    return "timeout";
  }
  if (reason === "request_success") {
    return "success";
  }
  return "failure";
}

function makeBaseResult(
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

function getInputBlockedReason(
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

function failedResult(
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

function makeArtifactPaths(input: {
  sessionDataDir: string;
  provider: string;
  model: string;
  inputHash: string;
  jobId: string;
}): {
  jobId: string;
  inputJsonPath: string;
  inputMarkdownPath: string;
  promptPath: string;
  rawOutputPath: string;
  stderrPath: string;
  repairPromptPath: string;
  repairRawOutputPath: string;
  repairStderrPath: string;
  draftJsonPath: string;
  draftMarkdownPath: string;
} {
  const dir = path.resolve(input.sessionDataDir, "ai-cleanup");
  const safeProvider = sanitizePathPart(input.provider);
  const safeModel = sanitizePathPart(input.model);
  const hash = input.inputHash.slice(0, 16);

  return {
    jobId: input.jobId,
    inputJsonPath: path.join(
      dir,
      `input.phase3.5-transcript-timeline-v1.${hash}.json`,
    ),
    inputMarkdownPath: path.join(
      dir,
      `input.phase3.5-transcript-timeline-v1.${hash}.md`,
    ),
    promptPath: path.join(
      dir,
      `prompt.${PHASE4_AI_CLEANUP_PROMPT_VERSION}.${input.jobId}.txt`,
    ),
    rawOutputPath: path.join(dir, `raw.${safeProvider}.${safeModel}.${input.jobId}.txt`),
    stderrPath: path.join(
      dir,
      `stderr.${safeProvider}.${safeModel}.${input.jobId}.txt`,
    ),
    repairPromptPath: path.join(
      dir,
      `prompt.repair.${PHASE4_AI_CLEANUP_PROMPT_VERSION}.${input.jobId}.txt`,
    ),
    repairRawOutputPath: path.join(
      dir,
      `raw.repair.${safeProvider}.${safeModel}.${input.jobId}.txt`,
    ),
    repairStderrPath: path.join(
      dir,
      `stderr.repair.${safeProvider}.${safeModel}.${input.jobId}.txt`,
    ),
    draftJsonPath: path.join(dir, `draft.${input.jobId}.json`),
    draftMarkdownPath: path.join(dir, `draft.${input.jobId}.md`),
  };
}

function makeAiCleanupJobId(input: {
  sessionId: string;
  provider: string;
  model: string;
  promptVersion: string;
  inputHash: string;
}): string {
  const stable = sha256Text(
    `${input.sessionId}\n${input.provider}\n${input.model}\n${input.promptVersion}\n${input.inputHash}`,
  ).slice(0, 16);
  return `ai_${sanitizePathPart(input.sessionId).slice(0, 48)}_${stable}`;
}

function sanitizePathPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 80) || "unknown";
}

function writeTextAtomic(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const partPath = `${filePath}.part`;
  writeFileSync(partPath, content, "utf8");
  renameSync(partPath, filePath);
}

function providerFailureKind(error: unknown): AiCleanupFailureKind {
  if (error instanceof AiCleanupProviderError) {
    return error.failureKind;
  }
  return "unknown";
}

function summarizeSchemaRepairFailure(
  initialIssues: readonly string[],
  repairError: unknown,
): string {
  const initialSummary = initialIssues.slice(0, 5).join("; ");
  const repairSummary = summarizeError(repairError);
  const message = [
    "회의록 JSON schema 검증에 실패했고 자동 repair도 실패했습니다.",
    initialSummary ? `initial: ${initialSummary}` : null,
    `repair: ${repairSummary}`,
  ]
    .filter((line): line is string => line !== null)
    .join(" ");
  return message.length <= 1000 ? message : `${message.slice(0, 1000)}...`;
}

function summarizeError(error: unknown): string {
  const message =
    error instanceof DraftValidationError
      ? error.issues.join("; ")
      : error instanceof DraftParseError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
  const redacted = redactSensitiveText(message);
  return redacted.length <= 1000 ? redacted : `${redacted.slice(0, 1000)}...`;
}
