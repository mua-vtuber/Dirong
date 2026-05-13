import assert from "node:assert/strict";
import test from "node:test";
import {
  nextRetryAttemptIso,
  planJobFailureRetry,
} from "./job-retry-policy.js";

test("planJobFailureRetry requeues retryable jobs with exponential backoff", () => {
  const nowMs = Date.parse("2026-05-13T00:00:00.000Z");

  assert.deepEqual(
    planJobFailureRetry({
      attempts: 2,
      maxAttempts: 3,
      now: "2026-05-13T00:00:00.000Z",
      nowMs,
    }),
    {
      status: "queued",
      nextAttemptAt: "2026-05-13T00:01:00.000Z",
    },
  );
});

test("planJobFailureRetry fails exhausted jobs at the provided timestamp", () => {
  assert.deepEqual(
    planJobFailureRetry({
      attempts: 3,
      maxAttempts: 3,
      now: "2026-05-13T00:00:00.000Z",
      nowMs: Date.parse("2026-05-14T00:00:00.000Z"),
    }),
    {
      status: "failed",
      nextAttemptAt: "2026-05-13T00:00:00.000Z",
    },
  );
});

test("nextRetryAttemptIso caps retry backoff at fifteen minutes", () => {
  assert.equal(
    nextRetryAttemptIso({
      attempts: 10,
      nowMs: Date.parse("2026-05-13T00:00:00.000Z"),
    }),
    "2026-05-13T00:15:00.000Z",
  );
});
