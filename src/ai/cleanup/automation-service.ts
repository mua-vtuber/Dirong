import { redactSensitiveText, summarizeSafeError } from "../../errors.js";
import {
  buildHumanStatusDisplay,
  type HumanStatusDisplay,
  type HumanStatusDisplayInput,
} from "../../messages/human-status.js";
import {
  resolveAppLocale,
  type AppLocaleResolver,
} from "../../i18n/app-locale.js";
import { formatLocaleText, t, type LocaleKey } from "../../i18n/catalog.js";
import type { DirongLocale } from "../../settings/local-settings-store.js";
import type {
  AiCleanupJobRow,
  AiCleanupLeaseRepairSummary,
  AiCleanupSttTerminalSnapshot,
} from "../../storage/rows.js";
import { EnabledPollingLoop } from "../../runtime/polling-loop.js";
import { buildPhase4TimelineInput } from "./timeline-input.js";
import type { AiCleanupProvider } from "./provider.js";
import { AiCleanupProviderError } from "./provider.js";
import { PHASE4_AI_CLEANUP_PROMPT_VERSION } from "./prompts.js";
import {
  buildPhase4ContextualInputHash,
  runAiCleanupForSession,
  type AiCleanupSessionContext,
  type AiCleanupRunOptions,
  type AiCleanupRunResult,
} from "./runner.js";
import type { AiProviderLifecycleService } from "./provider-lifecycle-service.js";
import {
  cloneAiCleanupProgressSnapshot,
  type AiCleanupProgressSnapshot,
} from "./progress.js";
import type { AiCleanupAutomationStore } from "./storage-port.js";

export type AiCleanupAutomationStatus =
  | "disabled"
  | "idle"
  | "waiting_for_finalized_session"
  | "waiting_for_stt"
  | "waiting_for_ai_provider"
  | "queued"
  | "running"
  | "done"
  | "already_done"
  | "blocked"
  | "failed"
  | "not_claimed"
  | "stopped";

export type AiCleanupAutomationJobSnapshot = {
  id: string;
  status: AiCleanupJobRow["status"];
  attempts: number;
  maxAttempts: number;
  inputHash: string;
  inputEntryCount: number;
  failureKind: string | null;
  lastError: string | null;
};

export type AiCleanupAutomationSnapshot = {
  enabled: boolean;
  status: AiCleanupAutomationStatus;
  provider: string;
  model: string;
  checkedAt: string | null;
  sessionId: string | null;
  message: string;
  userAction: string | null;
  technicalDetail: string | null;
  display?: HumanStatusDisplay;
  stt: AiCleanupSttTerminalSnapshot | null;
  job: AiCleanupAutomationJobSnapshot | null;
  lastRunStatus: AiCleanupRunResult["status"] | null;
  inFlightSessionIds: string[];
  repairedExpiredJobs: AiCleanupLeaseRepairSummary;
  repairedExpiredSttLeases: number;
  warnings: string[];
  progress: AiCleanupProgressSnapshot | null;
};

export type AiCleanupAutomationRetryResult = {
  ok: boolean;
  status: "done" | "failed" | "not_configured";
  message: string;
  userAction: string | null;
  job: AiCleanupAutomationJobSnapshot | null;
  snapshot: AiCleanupAutomationSnapshot;
};

export type AiCleanupAutomationServiceOptions = {
  enabled: boolean;
  provider: AiCleanupProvider;
  lifecycle: AiProviderLifecycleService;
  pollIntervalMs: number;
  sessionBatchLimit: number;
  readinessRetryMs: number;
  runner: Omit<AiCleanupRunOptions, "sessionId" | "dryRun" | "provider">;
  localeResolver?: AppLocaleResolver;
};

/**
 * Runtime-only Phase C automation coordinator.
 *
 * It does not persist readiness or automation state. Durable truth remains in
 * ai_cleanup_jobs and meeting_notes_drafts. Provider timeout/cancel remains
 * owned by the selected provider implementation; this coordinator only observes
 * runtime progress and durable job state.
 */
export class AiCleanupAutomationService {
  private readonly loop: EnabledPollingLoop<AiCleanupAutomationSnapshot>;
  private lastReadinessRetryAt = 0;
  private readonly inFlightSessionIds = new Set<string>();
  private snapshot: AiCleanupAutomationSnapshot;

  constructor(
    private readonly store: AiCleanupAutomationStore,
    private readonly options: AiCleanupAutomationServiceOptions,
  ) {
    this.snapshot = this.makeSnapshot({
      enabled: options.enabled,
      status: options.enabled ? "idle" : "disabled",
      provider: options.provider.providerName,
      model: options.provider.modelName,
      checkedAt: null,
      sessionId: null,
      message: options.enabled
        ? this.messageForStatus("idle")
        : this.messageForStatus("disabled"),
      userAction: options.enabled ? null : this.userActionForStatus("disabled"),
      technicalDetail: null,
      stt: null,
      job: null,
      lastRunStatus: null,
      inFlightSessionIds: [],
      repairedExpiredJobs: { requeued: 0, failed: 0 },
      repairedExpiredSttLeases: 0,
      warnings: [],
      progress: null,
    });
    this.loop = new EnabledPollingLoop({
      enabled: () => this.options.enabled,
      intervalMs: options.pollIntervalMs,
      runTick: (signal) => this.tick(signal),
      onScheduledError: (error) => this.handleScheduledError(error),
    });
  }

  start(): void {
    this.loop.start();
  }

  async stop(): Promise<void> {
    await this.loop.stop();
    this.markStopped();
  }

  private handleScheduledError(error: unknown): void {
    this.snapshot = this.makeSnapshot({
      ...this.snapshot,
      status: "failed",
      checkedAt: new Date().toISOString(),
      message: this.messageForStatus("failed"),
      userAction: this.userActionForStatus("failed"),
      technicalDetail: summarizeSafeError(error),
      progress: null,
    });
  }

  private markStopped(): void {
    this.snapshot = this.makeSnapshot({
      ...this.snapshot,
      status: "stopped",
      checkedAt: new Date().toISOString(),
      message: this.messageForStatus("stopped"),
      userAction: null,
      inFlightSessionIds: this.getInFlightSessionIds(),
      progress: null,
    });
  }

  getSnapshot(locale?: DirongLocale): AiCleanupAutomationSnapshot {
    return cloneSnapshot(
      localizeAiCleanupAutomationSnapshot(
        this.snapshot,
        resolveAppLocale({ locale, getLocale: this.options.localeResolver }),
      ),
    );
  }

  async runOnce(): Promise<AiCleanupAutomationSnapshot> {
    if (!this.options.enabled) {
      this.snapshot = this.makeSnapshot({
        ...this.snapshot,
        status: "disabled",
        checkedAt: new Date().toISOString(),
        message: this.messageForStatus("disabled"),
        userAction: this.userActionForStatus("disabled"),
        progress: null,
      });
      return this.getSnapshot();
    }

    return await this.loop.runOnce();
  }

  async retryFailedJob(
    input: { jobId: string },
    locale?: DirongLocale,
  ): Promise<AiCleanupAutomationRetryResult> {
    const resolvedLocale = resolveAppLocale({
      locale,
      getLocale: this.options.localeResolver,
    });
    if (!this.options.enabled) {
      return {
        ok: false,
        status: "not_configured",
        message: retryText(resolvedLocale, "disabledMessage"),
        userAction: retryText(resolvedLocale, "disabledAction"),
        job: null,
        snapshot: this.getSnapshot(resolvedLocale),
      };
    }
    const job = this.store.retryAiCleanupJob({
      jobId: input.jobId,
      nowIso: new Date().toISOString(),
      maxAttempts: this.options.runner.maxAttempts,
    });
    if (!job) {
      return {
        ok: false,
        status: "failed",
        message: retryText(resolvedLocale, "missingMessage"),
        userAction: retryText(resolvedLocale, "missingAction"),
        job: null,
        snapshot: this.getSnapshot(resolvedLocale),
      };
    }

    void this.runOnce().catch((error) => this.handleScheduledError(error));
    return {
      ok: true,
      status: "done",
      message: retryText(resolvedLocale, "queuedMessage"),
      userAction: null,
      job: makeJobSnapshot(job),
      snapshot: this.getSnapshot(resolvedLocale),
    };
  }

  private async tick(signal: AbortSignal): Promise<AiCleanupAutomationSnapshot> {
    const checkedAt = new Date().toISOString();
    const repairedExpiredSttLeases =
      this.store.releaseExpiredProcessingLeases(checkedAt);
    const repairedExpiredJobs =
      this.store.repairExpiredAiCleanupProcessingJobs();

    if (this.inFlightSessionIds.size > 0) {
      this.snapshot = this.makeSnapshot({
        ...this.snapshot,
        status: "running",
        checkedAt,
        message: this.messageForStatus("running"),
        userAction: null,
        repairedExpiredJobs,
        repairedExpiredSttLeases,
        inFlightSessionIds: this.getInFlightSessionIds(),
      });
      return this.getSnapshot();
    }

    const readiness = this.options.lifecycle.getSnapshot();
    if (readiness.status !== "ready") {
      this.maybeRetryReadiness();
      this.snapshot = this.makeSnapshot({
        ...this.snapshot,
        status: "waiting_for_ai_provider",
        checkedAt,
        sessionId: null,
        message: this.messageForStatus("waiting_for_ai_provider"),
        userAction:
          readiness.userAction ??
          this.userActionForStatus("waiting_for_ai_provider"),
        technicalDetail: readiness.technicalDetail,
        stt: null,
        job: null,
        repairedExpiredJobs,
        repairedExpiredSttLeases,
        warnings: [],
        progress: null,
      });
      return this.getSnapshot();
    }

    const sessions = this.store.listFinalizedSessionsForAiCleanupAutomation({
      limit: this.options.sessionBatchLimit,
      provider: this.options.provider.providerName,
      model: this.options.provider.modelName,
      promptVersion: PHASE4_AI_CLEANUP_PROMPT_VERSION,
      nowIso: checkedAt,
    });
    if (sessions.length === 0) {
      this.snapshot = this.makeSnapshot({
        ...this.snapshot,
        status: "waiting_for_finalized_session",
        checkedAt,
        sessionId: null,
        message: this.messageForStatus("waiting_for_finalized_session"),
        userAction: null,
        technicalDetail: null,
        stt: null,
        job: null,
        repairedExpiredJobs,
        repairedExpiredSttLeases,
        warnings: [],
        progress: null,
      });
      return this.getSnapshot();
    }

    let fallbackSnapshot: AiCleanupAutomationSnapshot | null = null;
    for (const session of sessions) {
      if (this.inFlightSessionIds.has(session.id)) {
        continue;
      }

      const stt = this.store.getAiCleanupSttTerminalSnapshot(session.id);
      if (!stt) {
        continue;
      }
      if (!stt.isTerminal) {
        fallbackSnapshot ??= this.makeSnapshot({
          ...this.snapshot,
          status: "waiting_for_stt",
          checkedAt,
          sessionId: session.id,
          message: this.messageForStatus("waiting_for_stt"),
          userAction: null,
          technicalDetail: null,
          stt,
          job: null,
          repairedExpiredJobs,
          repairedExpiredSttLeases,
          warnings: stt.warnings,
          progress: null,
        });
        continue;
      }

      const timelineInput = buildPhase4TimelineInput(this.store, {
        sessionId: session.id,
        includeFakeStt: false,
      });
      const locale = this.resolveLocale();
      const sessionContext = makeAiCleanupSessionContext(session);
      const effectiveInputHash = buildPhase4ContextualInputHash(
        timelineInput.inputHash,
        {
          notionCustomPropertyPrompt:
            this.options.runner.customNotionPropertyPrompt?.(sessionContext) ?? "",
          memberRosterPrompt:
            this.options.runner.memberRosterPrompt?.(sessionContext) ?? "",
          locale,
        },
      );
      const existingJob = this.store.getAiCleanupJobByIdentity({
        sessionId: session.id,
        provider: this.options.provider.providerName,
        model: this.options.provider.modelName,
        promptVersion: PHASE4_AI_CLEANUP_PROMPT_VERSION,
        inputHash: effectiveInputHash,
      });

      if (existingJob?.status === "processing") {
        this.snapshot = this.makeSnapshot({
          ...this.snapshot,
          status: "running",
          checkedAt,
          sessionId: session.id,
          message: this.messageForStatus("running"),
          userAction: null,
          technicalDetail: null,
          stt,
          job: makeJobSnapshot(existingJob),
          repairedExpiredJobs,
          repairedExpiredSttLeases,
          warnings: stt.warnings,
          progress: null,
        });
        return this.getSnapshot();
      }

      if (
        existingJob &&
        existingJob.status !== "queued"
      ) {
        fallbackSnapshot ??= this.makeSnapshot({
          ...this.snapshot,
          status: existingStatusToAutomationStatus(existingJob.status),
          checkedAt,
          sessionId: session.id,
          message: messageForExistingJob(existingJob, this.resolveLocale()),
          userAction: userActionForExistingJob(existingJob, this.resolveLocale()),
          technicalDetail: existingJob.last_error,
          stt,
          job: makeJobSnapshot(existingJob),
          repairedExpiredJobs,
          repairedExpiredSttLeases,
          warnings: stt.warnings,
          progress: null,
        });
        continue;
      }

      if (
        existingJob?.status === "queued" &&
        !isAiCleanupJobReadyToClaim(existingJob, checkedAt)
      ) {
        fallbackSnapshot ??= this.makeSnapshot({
          ...this.snapshot,
          status: "not_claimed",
          checkedAt,
          sessionId: session.id,
          message: this.messageForStatus("not_claimed"),
          userAction: this.userActionForStatus("not_claimed"),
          technicalDetail: existingJob.last_error,
          stt,
          job: makeJobSnapshot(existingJob),
          repairedExpiredJobs,
          repairedExpiredSttLeases,
          warnings: stt.warnings,
          progress: null,
        });
        continue;
      }

      if (!stt.canInvokeRunner) {
        fallbackSnapshot ??= this.makeSnapshot({
          ...this.snapshot,
          status: "waiting_for_stt",
          checkedAt,
          sessionId: session.id,
          message: this.messageForStatus("waiting_for_stt"),
          userAction: null,
          technicalDetail: null,
          stt,
          job: existingJob ? makeJobSnapshot(existingJob) : null,
          repairedExpiredJobs,
          repairedExpiredSttLeases,
          warnings: stt.warnings,
          progress: null,
        });
        continue;
      }

      return await this.runForSession(
        session.id,
        stt,
        existingJob,
        repairedExpiredJobs,
        repairedExpiredSttLeases,
        signal,
      );
    }

    this.snapshot =
      fallbackSnapshot ??
      this.makeSnapshot({
        ...this.snapshot,
        status: "idle",
        checkedAt,
        sessionId: null,
        message: this.messageForStatus("idle"),
        userAction: null,
        technicalDetail: null,
        stt: null,
        job: null,
        repairedExpiredJobs,
        repairedExpiredSttLeases,
        warnings: [],
        progress: null,
      });
    return this.getSnapshot();
  }

  private async runForSession(
    sessionId: string,
    stt: AiCleanupSttTerminalSnapshot,
    existingJob: AiCleanupJobRow | null,
    repairedExpiredJobs: AiCleanupLeaseRepairSummary,
    repairedExpiredSttLeases: number,
    signal: AbortSignal,
  ): Promise<AiCleanupAutomationSnapshot> {
    this.inFlightSessionIds.add(sessionId);
    this.snapshot = this.makeSnapshot({
      ...this.snapshot,
      status: existingJob?.status === "queued" ? "queued" : "running",
      checkedAt: new Date().toISOString(),
      sessionId,
      message:
        existingJob?.status === "queued"
          ? this.messageForStatus("queued")
          : this.messageForStatus("running"),
      userAction: null,
      technicalDetail: null,
      stt,
      job: existingJob ? makeJobSnapshot(existingJob) : null,
      repairedExpiredJobs,
      repairedExpiredSttLeases,
      warnings: stt.warnings,
      inFlightSessionIds: this.getInFlightSessionIds(),
      progress: null,
    });

    try {
      const result = await runAiCleanupForSession(this.store, {
        ...this.options.runner,
        sessionId,
        dryRun: false,
        provider: this.options.provider,
        locale: this.resolveLocale(),
        signal,
        progress: (progress) => this.acceptProgress(progress),
      });
      this.snapshot = snapshotFromRunResult({
        previous: this.snapshot,
        result,
        stt,
        repairedExpiredJobs,
        repairedExpiredSttLeases,
        inFlightSessionIds: this.getInFlightSessionIds(),
        locale: this.resolveLocale(),
      });
    } catch (error) {
      const providerFailure = error instanceof AiCleanupProviderError;
      if (providerFailure) {
        this.maybeRetryReadiness();
      }
      this.snapshot = this.makeSnapshot({
        ...this.snapshot,
        status: providerFailure ? "waiting_for_ai_provider" : "failed",
        checkedAt: new Date().toISOString(),
        sessionId,
        message: providerFailure
          ? this.messageForStatus("waiting_for_ai_provider")
          : this.messageForStatus("failed"),
        userAction: providerFailure
          ? this.userActionForStatus("waiting_for_ai_provider")
          : this.userActionForStatus("failed"),
        technicalDetail: summarizeSafeError(error),
        stt,
        job: null,
        repairedExpiredJobs,
        repairedExpiredSttLeases,
        warnings: stt.warnings,
        progress: this.snapshot.progress,
      });
    } finally {
      this.inFlightSessionIds.delete(sessionId);
      this.snapshot = this.makeSnapshot({
        ...this.snapshot,
        inFlightSessionIds: this.getInFlightSessionIds(),
      });
    }

    return this.getSnapshot();
  }

  private maybeRetryReadiness(): void {
    const now = Date.now();
    if (now - this.lastReadinessRetryAt < this.options.readinessRetryMs) {
      return;
    }
    this.lastReadinessRetryAt = now;
    void this.options.lifecycle.startPrepareInBackground();
  }

  private getInFlightSessionIds(): string[] {
    return [...this.inFlightSessionIds].sort();
  }

  private acceptProgress(progress: AiCleanupProgressSnapshot): void {
    if (
      this.inFlightSessionIds.size > 0 &&
      !this.inFlightSessionIds.has(progress.sessionId)
    ) {
      return;
    }
    this.snapshot = this.makeSnapshot({
      ...this.snapshot,
      sessionId: progress.sessionId,
      status: progress.phase === "failed" ? "failed" : "running",
      message: progress.message,
      checkedAt: progress.updatedAt,
      progress,
    });
  }

  private makeSnapshot(
    snapshot: AiCleanupAutomationSnapshot,
  ): AiCleanupAutomationSnapshot {
    return makeSnapshot(snapshot, this.resolveLocale());
  }

  private messageForStatus(status: AiCleanupAutomationStatus): string {
    return t(this.resolveLocale(), aiCleanupAutomationMessageKey(status));
  }

  private userActionForStatus(status: AiCleanupAutomationStatus): string | null {
    const key = aiCleanupAutomationUserActionKey(status);
    return key ? t(this.resolveLocale(), key) : null;
  }

  private resolveLocale(): DirongLocale {
    return resolveAppLocale({ getLocale: this.options.localeResolver });
  }
}

function makeAiCleanupSessionContext(input: {
  id: string;
  project_id: string | null;
}): AiCleanupSessionContext {
  return {
    sessionId: input.id,
    projectId: input.project_id,
  };
}

export function formatAiCleanupAutomationForStatus(
  snapshot: AiCleanupAutomationSnapshot,
  locale?: DirongLocale,
): string {
  const resolvedLocale = resolveAppLocale({ locale });
  const localized = localizeAiCleanupAutomationSnapshot(snapshot, resolvedLocale);
  const lines = [
    `${t(resolvedLocale, "runtimeStatus.aiCleanupAutomation.statusText.automation")}: ${localized.message}`,
    `${t(resolvedLocale, "runtimeStatus.aiCleanupAutomation.statusText.provider")}: ${snapshot.provider} / ${snapshot.model}`,
  ];
  if (snapshot.sessionId) {
    lines.push(
      `${t(resolvedLocale, "runtimeStatus.aiCleanupAutomation.statusText.session")}: ${snapshot.sessionId}`,
    );
  }
  if (snapshot.stt) {
    lines.push(
      [
        `${t(resolvedLocale, "runtimeStatus.aiCleanupAutomation.statusText.stt")}:`,
        `done:${snapshot.stt.sttDoneCount}`,
        `failed:${snapshot.stt.sttFailedCount}`,
        `missing_file:${snapshot.stt.sttFailedMissingFileCount}`,
        `real_transcript:${snapshot.stt.realTranscriptEntryCount}`,
      ].join(" "),
    );
  }
  if (snapshot.progress) {
    lines.push(
      [
        `${t(resolvedLocale, "runtimeStatus.aiCleanupAutomation.statusText.progress")}:`,
        snapshot.progress.phase,
        `elapsed:${snapshot.progress.elapsedMs}ms`,
        `lines:${snapshot.progress.streamLineCount}`,
        `bytes:${snapshot.progress.stdoutBytes}`,
        snapshot.progress.repairAttempt ? "repair:true" : "repair:false",
      ].join(" "),
    );
  }
  if (snapshot.warnings.length > 0) {
    lines.push(
      `${t(resolvedLocale, "runtimeStatus.aiCleanupAutomation.statusText.warning")}: ${snapshot.warnings.join(", ")}`,
    );
  }
  if (snapshot.repairedExpiredSttLeases > 0) {
    lines.push(formatLocaleText(
      resolvedLocale,
      "runtimeStatus.aiCleanupAutomation.statusText.sttLeaseRepair",
      { count: snapshot.repairedExpiredSttLeases },
    ));
  }
  if (localized.userAction) {
    lines.push(
      `${t(resolvedLocale, "runtimeStatus.aiCleanupAutomation.statusText.action")}: ${localized.userAction}`,
    );
  }
  return lines.join("\n");
}

function snapshotFromRunResult(input: {
  previous: AiCleanupAutomationSnapshot;
  result: AiCleanupRunResult;
  stt: AiCleanupSttTerminalSnapshot;
  repairedExpiredJobs: AiCleanupLeaseRepairSummary;
  repairedExpiredSttLeases: number;
  inFlightSessionIds: string[];
  locale: DirongLocale;
}): AiCleanupAutomationSnapshot {
  const { result } = input;
  const status = resultStatusToAutomationStatus(result.status);
  return makeSnapshot({
    ...input.previous,
    status,
    checkedAt: new Date().toISOString(),
    sessionId: result.sessionId,
    message: messageForRunResult(result, input.locale),
    userAction: userActionForRunResult(result, input.locale),
    technicalDetail: result.error,
    stt: input.stt,
    job: result.job ? makeJobSnapshot(result.job) : null,
    lastRunStatus: result.status,
    repairedExpiredJobs: input.repairedExpiredJobs,
    repairedExpiredSttLeases: input.repairedExpiredSttLeases,
    inFlightSessionIds: input.inFlightSessionIds,
    warnings: input.stt.warnings,
    progress: input.previous.progress,
  }, input.locale);
}

function resultStatusToAutomationStatus(
  status: AiCleanupRunResult["status"],
): AiCleanupAutomationStatus {
  if (status === "dry_run") {
    return "idle";
  }
  if (status === "already_done") {
    return "already_done";
  }
  return status;
}

function existingStatusToAutomationStatus(
  status: AiCleanupJobRow["status"],
): AiCleanupAutomationStatus {
  if (status === "done") {
    return "already_done";
  }
  if (status === "processing") {
    return "running";
  }
  return status;
}

function messageForRunResult(
  result: AiCleanupRunResult,
  locale: DirongLocale,
): string {
  return t(locale, aiCleanupAutomationMessageKey(
    resultStatusToAutomationStatus(result.status),
  ));
}

function userActionForRunResult(
  result: AiCleanupRunResult,
  locale: DirongLocale,
): string | null {
  const key = aiCleanupAutomationUserActionKey(
    resultStatusToAutomationStatus(result.status),
  );
  return key ? t(locale, key) : null;
}

function messageForExistingJob(
  job: AiCleanupJobRow,
  locale: DirongLocale,
): string {
  return t(locale, aiCleanupAutomationMessageKey(
    existingStatusToAutomationStatus(job.status),
  ));
}

function userActionForExistingJob(
  job: AiCleanupJobRow,
  locale: DirongLocale,
): string | null {
  const key = aiCleanupAutomationUserActionKey(
    existingStatusToAutomationStatus(job.status),
  );
  return key ? t(locale, key) : null;
}

function isAiCleanupJobReadyToClaim(
  job: AiCleanupJobRow,
  nowIso: string,
): boolean {
  return job.next_attempt_at <= nowIso;
}

function makeJobSnapshot(job: AiCleanupJobRow): AiCleanupAutomationJobSnapshot {
  return {
    id: job.id,
    status: job.status,
    attempts: job.attempts,
    maxAttempts: job.max_attempts,
    inputHash: job.input_hash,
    inputEntryCount: job.input_entry_count,
    failureKind: job.failure_kind,
    lastError:
      job.last_error === null ? null : redactSensitiveText(job.last_error),
  };
}

function retryText(
  locale: DirongLocale,
  key:
    | "disabledMessage"
    | "disabledAction"
    | "missingMessage"
    | "missingAction"
    | "queuedMessage",
): string {
  const keys: Record<typeof key, LocaleKey> = {
    disabledMessage: "runtimeStatus.aiCleanupAutomation.retry.disabledMessage",
    disabledAction: "runtimeStatus.aiCleanupAutomation.retry.disabledAction",
    missingMessage: "runtimeStatus.aiCleanupAutomation.retry.missingMessage",
    missingAction: "runtimeStatus.aiCleanupAutomation.retry.missingAction",
    queuedMessage: "runtimeStatus.aiCleanupAutomation.retry.queuedMessage",
  };
  return t(locale, keys[key]);
}

function makeSnapshot(
  snapshot: AiCleanupAutomationSnapshot,
  locale: DirongLocale,
): AiCleanupAutomationSnapshot {
  return cloneSnapshot(localizeAiCleanupAutomationSnapshot({
    ...snapshot,
    technicalDetail:
      snapshot.technicalDetail === null
        ? null
        : redactSensitiveText(snapshot.technicalDetail),
  }, locale));
}

function cloneSnapshot(
  snapshot: AiCleanupAutomationSnapshot,
): AiCleanupAutomationSnapshot {
  return {
    ...snapshot,
    display: snapshot.display
      ? {
          ...snapshot.display,
          details: snapshot.display.details.map((detail) => ({ ...detail })),
        }
      : undefined,
    stt: snapshot.stt
      ? {
          ...snapshot.stt,
          warnings: [...snapshot.stt.warnings],
        }
      : null,
    job: snapshot.job ? { ...snapshot.job } : null,
    progress: cloneAiCleanupProgressSnapshot(snapshot.progress),
    inFlightSessionIds: [...snapshot.inFlightSessionIds],
    repairedExpiredJobs: { ...snapshot.repairedExpiredJobs },
    warnings: [...snapshot.warnings],
  };
}

function localizeAiCleanupAutomationSnapshot(
  snapshot: AiCleanupAutomationSnapshot,
  locale: DirongLocale,
): AiCleanupAutomationSnapshot {
  const message = t(locale, aiCleanupAutomationMessageKey(snapshot.status));
  const userActionKey = aiCleanupAutomationUserActionKey(snapshot.status);
  const localized = {
    ...snapshot,
    message,
    userAction: userActionKey ? t(locale, userActionKey) : null,
  };
  return {
    ...localized,
    display: buildAiCleanupAutomationDisplay(locale, localized),
  };
}

function buildAiCleanupAutomationDisplay(
  locale: DirongLocale,
  snapshot: AiCleanupAutomationSnapshot,
): HumanStatusDisplay {
  return buildHumanStatusDisplay(locale, {
    ...aiCleanupAutomationDisplayKeys(snapshot.status),
    status: snapshot.status,
    message: snapshot.message,
    userAction: snapshot.userAction,
    technicalDetail: snapshot.technicalDetail,
    details: [
      { label: "provider", value: snapshot.provider },
      { label: "model", value: snapshot.model },
      { label: "sessionId", value: snapshot.sessionId },
      { label: "stt", value: snapshot.stt },
      { label: "job", value: snapshot.job },
      { label: "lastRunStatus", value: snapshot.lastRunStatus },
      { label: "inFlightSessionIds", value: snapshot.inFlightSessionIds },
      { label: "repairedExpiredJobs", value: snapshot.repairedExpiredJobs },
      { label: "repairedExpiredSttLeases", value: snapshot.repairedExpiredSttLeases },
      { label: "warnings", value: snapshot.warnings },
      { label: "progress", value: snapshot.progress },
    ],
  });
}

function aiCleanupAutomationDisplayKeys(
  status: AiCleanupAutomationStatus,
): Pick<
  HumanStatusDisplayInput,
  "titleKey" | "descriptionKey" | "nextActionKey"
> {
  switch (status) {
    case "disabled":
      return {
        titleKey: "statusDisplay.aiCleanup.disabled.title",
        descriptionKey: "statusDisplay.aiCleanup.disabled.description",
        nextActionKey: "statusDisplay.aiCleanup.disabled.nextAction",
      };
    case "waiting_for_finalized_session":
      return {
        titleKey: "statusDisplay.aiCleanup.waitingForFinalizedSession.title",
        descriptionKey: "statusDisplay.aiCleanup.waitingForFinalizedSession.description",
      };
    case "waiting_for_stt":
      return {
        titleKey: "statusDisplay.aiCleanup.waitingForStt.title",
        descriptionKey: "statusDisplay.aiCleanup.waitingForStt.description",
      };
    case "waiting_for_ai_provider":
      return {
        titleKey: "statusDisplay.aiCleanup.waitingForAiProvider.title",
        descriptionKey: "statusDisplay.aiCleanup.waitingForAiProvider.description",
        nextActionKey: "statusDisplay.aiCleanup.waitingForAiProvider.nextAction",
      };
    case "queued":
      return {
        titleKey: "statusDisplay.aiCleanup.queued.title",
        descriptionKey: "statusDisplay.aiCleanup.queued.description",
      };
    case "running":
      return {
        titleKey: "statusDisplay.aiCleanup.running.title",
        descriptionKey: "statusDisplay.aiCleanup.running.description",
      };
    case "done":
      return {
        titleKey: "statusDisplay.aiCleanup.done.title",
        descriptionKey: "statusDisplay.aiCleanup.done.description",
      };
    case "already_done":
      return {
        titleKey: "statusDisplay.aiCleanup.alreadyDone.title",
        descriptionKey: "statusDisplay.aiCleanup.alreadyDone.description",
      };
    case "blocked":
      return {
        titleKey: "statusDisplay.aiCleanup.blocked.title",
        descriptionKey: "statusDisplay.aiCleanup.blocked.description",
        nextActionKey: "statusDisplay.aiCleanup.blocked.nextAction",
      };
    case "failed":
      return {
        titleKey: "statusDisplay.aiCleanup.failed.title",
        descriptionKey: "statusDisplay.aiCleanup.failed.description",
        nextActionKey: "statusDisplay.aiCleanup.failed.nextAction",
      };
    case "not_claimed":
      return {
        titleKey: "statusDisplay.aiCleanup.notClaimed.title",
        descriptionKey: "statusDisplay.aiCleanup.notClaimed.description",
      };
    case "stopped":
      return {
        titleKey: "statusDisplay.aiCleanup.stopped.title",
        descriptionKey: "statusDisplay.aiCleanup.stopped.description",
      };
    case "idle":
    default:
      return {
        titleKey: "statusDisplay.aiCleanup.idle.title",
        descriptionKey: "statusDisplay.aiCleanup.idle.description",
      };
  }
}

function aiCleanupAutomationMessageKey(
  status: AiCleanupAutomationStatus,
): LocaleKey {
  switch (status) {
    case "disabled":
      return "runtimeStatus.aiCleanupAutomation.disabled.message";
    case "waiting_for_finalized_session":
      return "runtimeStatus.aiCleanupAutomation.waitingForFinalizedSession.message";
    case "waiting_for_stt":
      return "runtimeStatus.aiCleanupAutomation.waitingForStt.message";
    case "waiting_for_ai_provider":
      return "runtimeStatus.aiCleanupAutomation.waitingForAiProvider.message";
    case "queued":
      return "runtimeStatus.aiCleanupAutomation.queued.message";
    case "running":
      return "runtimeStatus.aiCleanupAutomation.running.message";
    case "done":
      return "runtimeStatus.aiCleanupAutomation.done.message";
    case "already_done":
      return "runtimeStatus.aiCleanupAutomation.alreadyDone.message";
    case "blocked":
      return "runtimeStatus.aiCleanupAutomation.blocked.message";
    case "failed":
      return "runtimeStatus.aiCleanupAutomation.failed.message";
    case "not_claimed":
      return "runtimeStatus.aiCleanupAutomation.notClaimed.message";
    case "stopped":
      return "runtimeStatus.aiCleanupAutomation.stopped.message";
    case "idle":
    default:
      return "runtimeStatus.aiCleanupAutomation.idle.message";
  }
}

function aiCleanupAutomationUserActionKey(
  status: AiCleanupAutomationStatus,
): LocaleKey | null {
  switch (status) {
    case "disabled":
      return "runtimeStatus.aiCleanupAutomation.disabled.action";
    case "waiting_for_ai_provider":
      return "runtimeStatus.aiCleanupAutomation.waitingForAiProvider.action";
    case "blocked":
      return "runtimeStatus.aiCleanupAutomation.blocked.action";
    case "failed":
      return "runtimeStatus.aiCleanupAutomation.failed.action";
    case "not_claimed":
      return "runtimeStatus.aiCleanupAutomation.notClaimed.action";
    default:
      return null;
  }
}
