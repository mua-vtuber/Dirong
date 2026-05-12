import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DirongDatabase } from "../storage/sqlite.js";
import { NotionDashboardService } from "./dashboard-service.js";
import {
  DEFAULT_NOTION_PROPERTY_NAMES,
  type NotionRuntimeSettings,
} from "./settings.js";

test("NotionDashboardService reads latest settings for snapshots", () => {
  const fixture = createFixture();
  try {
    let currentSettings = notionSettings({
      enabled: false,
      apiKey: null,
      targetUrl: null,
    });
    const service = new NotionDashboardService({
      settings: currentSettings,
      getSettings: () => currentSettings,
      database: fixture.database,
      config: { sttLeaseMs: 60000 },
      workerId: "notion-dashboard-test",
    });

    const before = service.getSnapshot();
    currentSettings = notionSettings({
      enabled: true,
      apiKey: "ntn_test_dynamic_dashboard_secret",
      targetUrl: "01234567-89ab-cdef-0123-456789abcdef",
    });
    const after = service.getSnapshot();
    const serialized = JSON.stringify(after);

    assert.equal(before.status, "disabled");
    assert.equal(before.settings.apiKey, "[MISSING]");
    assert.equal(after.status, "ready");
    assert.equal(after.settings.apiKey, "[REDACTED]");
    assert.doesNotMatch(serialized, /ntn_test_dynamic_dashboard_secret/);
  } finally {
    fixture.close();
  }
});

function createFixture(): {
  database: DirongDatabase;
  close: () => void;
} {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-notion-dashboard-"));
  const database = new DirongDatabase(path.join(dir, "dirong.sqlite"), 1000);
  return {
    database,
    close: () => {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function notionSettings(
  overrides: Partial<NotionRuntimeSettings> = {},
): NotionRuntimeSettings {
  return {
    enabled: true,
    apiKey: "ntn_test_secret",
    apiVersion: "2026-03-11",
    baseUrl: "https://api.notion.com",
    requestTimeoutMs: 30000,
    targetUrl: "01234567-89ab-cdef-0123-456789abcdef",
    targetType: "data_source",
    uploadMode: "manual",
    templateType: "app",
    includeTranscript: "never",
    autoPollMs: 5000,
    leaseMs: 60000,
    maxAttempts: 3,
    propertyNames: DEFAULT_NOTION_PROPERTY_NAMES,
    ...overrides,
  };
}
