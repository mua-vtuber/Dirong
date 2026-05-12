import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DirongDatabase } from "../storage/sqlite.js";
import { NotionDashboardService } from "./dashboard-service.js";
import type { NotionClient } from "./client.js";
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

test("NotionDashboardService manual upload uses the latest settings client", async () => {
  const fixture = createFixture();
  try {
    let currentSettings = notionSettings({
      apiKey: "ntn_old_dashboard_secret",
    });
    const seenApiKeys: Array<string | null> = [];
    const service = new NotionDashboardService({
      settings: currentSettings,
      getSettings: () => currentSettings,
      notionClientFactory: (settings) => {
        seenApiKeys.push(settings.apiKey);
        return new FakeNotionClient();
      },
      database: fixture.database,
      config: { sttLeaseMs: 60000 },
      workerId: "notion-dashboard-test",
    });

    currentSettings = notionSettings({
      apiKey: "ntn_new_dashboard_secret",
    });
    const result = await service.runManualUpload({
      draftId: "missing-draft",
      sessionId: null,
      force: false,
    });

    assert.equal(result.status, "draft_not_found");
    assert.deepEqual(seenApiKeys, ["ntn_new_dashboard_secret"]);
  } finally {
    fixture.close();
  }
});

class FakeNotionClient implements NotionClient {
  async retrievePage(): Promise<Record<string, unknown>> {
    return { id: "page-1", object: "page" };
  }

  async retrieveDatabase(): Promise<Record<string, unknown>> {
    return { data_sources: [{ id: "01234567-89ab-cdef-0123-456789abcdef" }] };
  }

  async createDatabase(): Promise<Record<string, unknown>> {
    return { id: "database-1", data_sources: [] };
  }

  async createDataSource(): Promise<Record<string, unknown>> {
    return { id: "data-source-1", properties: {} };
  }

  async retrieveDataSource(): Promise<Record<string, unknown>> {
    return {
      id: "01234567-89ab-cdef-0123-456789abcdef",
      name: "회의록",
      properties: completeProperties(),
    };
  }

  async updateDataSource(): Promise<Record<string, unknown>> {
    return {
      id: "01234567-89ab-cdef-0123-456789abcdef",
      name: "회의록",
      properties: completeProperties(),
    };
  }

  async queryDataSource(): Promise<Record<string, unknown>> {
    return { results: [] };
  }

  async createPage(): Promise<Record<string, unknown>> {
    return { id: "page-1", url: "https://notion.so/page-1" };
  }

  async updatePage(): Promise<Record<string, unknown>> {
    return { id: "page-1", url: "https://notion.so/page-1" };
  }

  async appendBlockChildren(): Promise<Record<string, unknown>> {
    return { results: [] };
  }

  async retrieveBlockChildren(): Promise<Record<string, unknown>> {
    return { results: [] };
  }
}

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

function completeProperties(): Record<string, { id: string; type: string }> {
  return {
    Name: { id: "title-id", type: "title" },
    Date: { id: "date-id", type: "date" },
    "Meeting Time": { id: "meeting-time-id", type: "rich_text" },
    Channel: { id: "channel-id", type: "rich_text" },
    Participants: { id: "participants-id", type: "multi_select" },
    Status: { id: "status-id", type: "select" },
    "Session ID": { id: "session-id", type: "rich_text" },
    "Draft ID": { id: "draft-id", type: "rich_text" },
    "Dirong Content Hash": { id: "content-hash-id", type: "rich_text" },
    "Local Status": { id: "local-status-id", type: "rich_text" },
  };
}
