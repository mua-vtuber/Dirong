import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_REGISTERED_SENSITIVE_VALUE_LIMIT,
  getRegisteredSensitiveValueCount,
  redactForJson,
  redactSensitiveText,
  registerSensitiveValue,
  summarizeSafeError,
  summarizeSafeText,
  toLocalizedErrorMessage,
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

test("redaction keeps instructional token wording and safe secret snapshots", () => {
  assert.equal(
    redactSensitiveText("Notion token 또는 디롱이 전용 parent page를 저장해 주세요."),
    "Notion token 또는 디롱이 전용 parent page를 저장해 주세요.",
  );
  assert.equal(
    redactSensitiveText("token: raw-token-value"),
    "token: [REDACTED]",
  );
  assert.deepEqual(
    redactForJson({
      secrets: {
        discordBot: {
          configured: true,
          displayValue: "[REDACTED]",
        },
      },
      token: "raw-token-value",
    }),
    {
      secrets: {
        discordBot: {
          configured: true,
          displayValue: "[REDACTED]",
        },
      },
      token: "[REDACTED]",
    },
  );
});

test("localized error messages keep technical details out of the primary Discord text", () => {
  assert.match(
    toLocalizedErrorMessage(new Error("Discord request timed out"), "en"),
    /Discord voice connection was not ready/,
  );
  assert.match(
    toLocalizedErrorMessage(new Error("Discord request timed out"), "ko"),
    /Discord 음성 연결이 제한 시간 안에 준비되지 않았습니다/,
  );
});
