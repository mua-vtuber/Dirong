const MAX_RETRY_BACKOFF_MS = 15 * 60 * 1000;
const BASE_RETRY_BACKOFF_MS = 30 * 1000;

export function canRetryJob(input: {
  attempts: number;
  maxAttempts: number;
}): boolean {
  return input.attempts < input.maxAttempts;
}

export function nextRetryAttemptIso(input: {
  attempts: number;
  nowMs?: number;
}): string {
  const backoffMs = Math.min(
    MAX_RETRY_BACKOFF_MS,
    BASE_RETRY_BACKOFF_MS *
      Math.max(1, 2 ** Math.max(0, input.attempts - 1)),
  );
  return new Date((input.nowMs ?? Date.now()) + backoffMs).toISOString();
}

export type JobFailureRetryPlan = {
  status: "queued" | "failed";
  nextAttemptAt: string;
};

export function planJobFailureRetry(input: {
  attempts: number;
  maxAttempts: number;
  now: string;
  nowMs?: number;
}): JobFailureRetryPlan {
  if (!canRetryJob(input)) {
    return {
      status: "failed",
      nextAttemptAt: input.now,
    };
  }

  return {
    status: "queued",
    nextAttemptAt: nextRetryAttemptIso({
      attempts: input.attempts,
      nowMs: input.nowMs,
    }),
  };
}
