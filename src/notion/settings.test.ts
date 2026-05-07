import assert from "node:assert/strict";
import test from "node:test";
import { redactForJson, redactSensitiveText } from "../errors.js";
import { loadNotionSettingsFromEnv } from "../settings/env-settings-loader.js";
import { snapshotNotionRuntimeSettings } from "./settings.js";

test("loadNotionSettingsFromEnv defaults to disabled bootstrap settings", () => {
  const settings = loadNotionSettingsFromEnv({} as NodeJS.ProcessEnv);

  assert.equal(settings.enabled, false);
  assert.equal(settings.apiKey, null);
  assert.equal(settings.apiVersion, "2026-03-11");
  assert.equal(settings.baseUrl, "https://api.notion.com");
  assert.equal(settings.targetUrl, null);
  assert.equal(settings.targetType, "data_source");
  assert.equal(settings.uploadMode, "manual");
  assert.equal(settings.templateType, "app");
  assert.equal(settings.includeTranscript, "never");
  assert.equal(settings.autoPollMs, 5000);
  assert.equal(settings.leaseMs, 600000);
  assert.equal(settings.maxAttempts, 3);
  assert.equal(settings.propertyNames.draftId, "Draft ID");
});

test("loadNotionSettingsFromEnv reads enabled settings and property names", () => {
  const settings = loadNotionSettingsFromEnv({
    NOTION_EXPORT_ENABLED: "true",
    NOTION_API_KEY: "ntn_test_secret",
    NOTION_API_VERSION: "2026-03-11",
    NOTION_BASE_URL: "http://127.0.0.1:4545",
    NOTION_TARGET_URL: "0123456789abcdef0123456789abcdef",
    NOTION_UPLOAD_MODE: "automatic_after_ai_cleanup",
    NOTION_TEMPLATE_TYPE: "app",
    NOTION_PROPERTY_TITLE: "회의록",
    NOTION_AUTO_POLL_MS: "1000",
    NOTION_LEASE_MS: "2000",
    NOTION_MAX_ATTEMPTS: "4",
  } as NodeJS.ProcessEnv, {
    allowTestNotionBaseUrl: true,
  });

  assert.equal(settings.enabled, true);
  assert.equal(settings.apiKey, "ntn_test_secret");
  assert.equal(settings.baseUrl, "http://127.0.0.1:4545");
  assert.equal(settings.uploadMode, "automatic_after_ai_cleanup");
  assert.equal(settings.propertyNames.title, "회의록");
  assert.equal(settings.autoPollMs, 1000);
  assert.equal(settings.leaseMs, 2000);
  assert.equal(settings.maxAttempts, 4);
});

test("loadNotionSettingsFromEnv accepts missing token and target when disabled", () => {
  const settings = loadNotionSettingsFromEnv({
    NOTION_EXPORT_ENABLED: "false",
  } as NodeJS.ProcessEnv);

  assert.equal(settings.enabled, false);
  assert.equal(settings.apiKey, null);
  assert.equal(settings.targetUrl, null);
});

test("loadNotionSettingsFromEnv requires token and target when enabled", () => {
  assert.throws(
    () =>
      loadNotionSettingsFromEnv({
        NOTION_EXPORT_ENABLED: "true",
      } as NodeJS.ProcessEnv),
    /NOTION_API_KEY, NOTION_TARGET_URL/,
  );
});

test("loadNotionSettingsFromEnv rejects unsupported MVP switches", () => {
  assert.throws(
    () =>
      loadNotionSettingsFromEnv({
        NOTION_TARGET_TYPE: "page",
      } as NodeJS.ProcessEnv),
    /NOTION_TARGET_TYPE/,
  );
  assert.throws(
    () =>
      loadNotionSettingsFromEnv({
        NOTION_INCLUDE_TRANSCRIPT: "full",
      } as NodeJS.ProcessEnv),
    /NOTION_INCLUDE_TRANSCRIPT/,
  );
});

test("Notion settings snapshots and generic JSON redaction hide tokens", () => {
  const settings = loadNotionSettingsFromEnv({
    NOTION_EXPORT_ENABLED: "true",
    NOTION_API_KEY: "ntn_test_secret",
    NOTION_TARGET_URL: "0123456789abcdef0123456789abcdef",
  } as NodeJS.ProcessEnv);

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
