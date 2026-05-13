import assert from "node:assert/strict";
import test from "node:test";
import { redactForJson, redactSensitiveText } from "../errors.js";
import { DEFAULT_NOTION_SETTINGS } from "../settings/defaults.js";
import {
  snapshotNotionRuntimeSettings,
  validateNotionRuntimeSettings,
} from "./settings.js";

test("default Notion runtime settings are disabled until product setup enables them", () => {
  assert.equal(DEFAULT_NOTION_SETTINGS.enabled, false);
  assert.equal(DEFAULT_NOTION_SETTINGS.apiKey, null);
  assert.equal(DEFAULT_NOTION_SETTINGS.apiVersion, "2026-03-11");
  assert.equal(DEFAULT_NOTION_SETTINGS.baseUrl, "https://api.notion.com");
  assert.equal(DEFAULT_NOTION_SETTINGS.requestTimeoutMs, 30000);
  assert.equal(DEFAULT_NOTION_SETTINGS.targetUrl, null);
  assert.equal(DEFAULT_NOTION_SETTINGS.targetType, "data_source");
  assert.equal(DEFAULT_NOTION_SETTINGS.uploadMode, "manual");
  assert.equal(DEFAULT_NOTION_SETTINGS.templateType, "app");
  assert.equal(DEFAULT_NOTION_SETTINGS.includeTranscript, "never");
  assert.equal(DEFAULT_NOTION_SETTINGS.autoPollMs, 5000);
  assert.equal(DEFAULT_NOTION_SETTINGS.leaseMs, 600000);
  assert.equal(DEFAULT_NOTION_SETTINGS.maxAttempts, 3);
  assert.equal(DEFAULT_NOTION_SETTINGS.propertyNames.draftId, "Draft ID");
});

test("validateNotionRuntimeSettings requires a stored token only when enabled", () => {
  assert.deepEqual(validateNotionRuntimeSettings(DEFAULT_NOTION_SETTINGS), {
    ok: true,
  });

  assert.deepEqual(
    validateNotionRuntimeSettings({
      ...DEFAULT_NOTION_SETTINGS,
      enabled: true,
    }),
    {
      ok: false,
      missingKeys: ["notion.token"],
      userAction:
        "Notion 업로드를 켜려면 설정 마법사에서 Notion 연결 토큰을 저장해 주세요.",
    },
  );

  assert.deepEqual(
    validateNotionRuntimeSettings({
      ...DEFAULT_NOTION_SETTINGS,
      enabled: true,
      apiKey: "ntn_test_secret",
    }),
    { ok: true },
  );
});

test("Notion settings snapshots and generic JSON redaction hide tokens", () => {
  const settings = {
    ...DEFAULT_NOTION_SETTINGS,
    enabled: true,
    apiKey: "ntn_test_secret",
  };

  assert.equal(snapshotNotionRuntimeSettings(settings).apiKey, "[REDACTED]");
  assert.equal(
    (redactForJson({ notion: settings }) as { notion: { apiKey: string } })
      .notion.apiKey,
    "[REDACTED]",
  );
  assert.equal(
    redactSensitiveText("Notion token=ntn_test_secret"),
    "Notion token=[REDACTED]",
  );
});
