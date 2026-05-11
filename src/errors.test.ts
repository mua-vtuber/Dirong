import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_REGISTERED_SENSITIVE_VALUE_LIMIT,
  getRegisteredSensitiveValueCount,
  redactSensitiveText,
  registerSensitiveValue,
  summarizeSafeError,
  summarizeSafeText,
} from "./errors.js";

test("registered sensitive values are capped with oldest values evicted", () => {
  const evicted = "registered-value-old-000000";
  registerSensitiveValue(evicted);

  let newest = "";
  for (let index = 0; index < DEFAULT_REGISTERED_SENSITIVE_VALUE_LIMIT; index += 1) {
    newest = `registered-value-new-${index.toString().padStart(6, "0")}`;
    registerSensitiveValue(newest);
  }

  assert.ok(
    getRegisteredSensitiveValueCount() <= DEFAULT_REGISTERED_SENSITIVE_VALUE_LIMIT,
  );
  assert.equal(redactSensitiveText(`leak ${evicted}`), `leak ${evicted}`);
  assert.equal(redactSensitiveText(`leak ${newest}`), "leak [REDACTED_SECRET]");
});

test("summarizeSafeError redacts and truncates consistently", () => {
  registerSensitiveValue("registered-summary-secret");

  assert.equal(
    summarizeSafeError(new Error("failed with registered-summary-secret")),
    "failed with [REDACTED_SECRET]",
  );
  assert.equal(summarizeSafeText("abcdef", 3), "abc...");
});
