import { redactSensitiveText, summarizeSafeError } from "../../errors.js";

export type AiCleanupProgressPhase =
  | "preparing_input"
  | "claiming_job"
  | "writing_prompt_artifacts"
  | "starting_claude"
  | "waiting_for_first_stream_event"
  | "receiving_stream"
  | "result_boundary_received"
  | "writing_raw_artifacts"
  | "parsing_json"
  | "validating_schema"
  | "repairing_schema"
  | "rendering_draft"
  | "completed"
  | "failed";

export type AiCleanupProgressSnapshot = {
  sessionId: string;
  jobId: string | null;
  provider: string;
  model: string;
  phase: AiCleanupProgressPhase;
  message: string;
  startedAt: string;
  updatedAt: string;
  elapsedMs: number;
  attempt: number | null;
  repairAttempt: boolean;
  processPid: number | null;
  streamLineCount: number;
  stdoutBytes: number;
  stderrLineCount: number;
  lastEventType: string | null;
  resultReceived: boolean;
  warning: string | null;
};

export type AiCleanupProgressContext = {
  sessionId: string;
  jobId: string | null;
  provider: string;
  model: string;
  startedAt: string;
  startedAtMs: number;
  attempt: number | null;
  repairAttempt: boolean;
};

export type AiCleanupProgressUpdate = {
  phase: AiCleanupProgressPhase;
  message: string;
  jobId?: string | null;
  attempt?: number | null;
  repairAttempt?: boolean;
  processPid?: number | null;
  streamLineCount?: number;
  stdoutBytes?: number;
  stderrLineCount?: number;
  lastEventType?: string | null;
  resultReceived?: boolean;
  warning?: string | null;
};

export type AiCleanupProgressObserver = (
  snapshot: AiCleanupProgressSnapshot,
) => void;

export function makeAiCleanupProgressContext(input: {
  sessionId: string;
  jobId?: string | null;
  provider: string;
  model: string;
  attempt?: number | null;
  repairAttempt?: boolean;
  now?: () => number;
}): AiCleanupProgressContext {
  const startedAtMs = input.now?.() ?? Date.now();
  return {
    sessionId: input.sessionId,
    jobId: input.jobId ?? null,
    provider: input.provider,
    model: input.model,
    startedAt: new Date(startedAtMs).toISOString(),
    startedAtMs,
    attempt: input.attempt ?? null,
    repairAttempt: input.repairAttempt ?? false,
  };
}

export function buildAiCleanupProgressSnapshot(
  context: AiCleanupProgressContext,
  update: AiCleanupProgressUpdate,
  now = Date.now(),
): AiCleanupProgressSnapshot {
  return sanitizeAiCleanupProgressSnapshot({
    sessionId: context.sessionId,
    jobId: update.jobId ?? context.jobId,
    provider: context.provider,
    model: context.model,
    phase: update.phase,
    message: update.message,
    startedAt: context.startedAt,
    updatedAt: new Date(now).toISOString(),
    elapsedMs: Math.max(0, now - context.startedAtMs),
    attempt: update.attempt ?? context.attempt,
    repairAttempt: update.repairAttempt ?? context.repairAttempt,
    processPid: update.processPid ?? null,
    streamLineCount: update.streamLineCount ?? 0,
    stdoutBytes: update.stdoutBytes ?? 0,
    stderrLineCount: update.stderrLineCount ?? 0,
    lastEventType: update.lastEventType ?? null,
    resultReceived: update.resultReceived ?? false,
    warning: update.warning ?? null,
  });
}

export function safeEmitAiCleanupProgress(
  observer: AiCleanupProgressObserver | undefined,
  context: AiCleanupProgressContext,
  update: AiCleanupProgressUpdate,
): void {
  if (!observer) {
    return;
  }

  try {
    observer(buildAiCleanupProgressSnapshot(context, update));
  } catch (error) {
    console.warn(`AI cleanup progress observer failed: ${summarizeSafeError(error, 300)}`);
  }
}

export function sanitizeAiCleanupProgressSnapshot(
  snapshot: AiCleanupProgressSnapshot,
): AiCleanupProgressSnapshot {
  return {
    ...snapshot,
    warning:
      snapshot.warning === null ? null : redactSensitiveText(snapshot.warning),
  };
}

export function cloneAiCleanupProgressSnapshot(
  snapshot: AiCleanupProgressSnapshot | null,
): AiCleanupProgressSnapshot | null {
  return snapshot ? { ...sanitizeAiCleanupProgressSnapshot(snapshot) } : null;
}
