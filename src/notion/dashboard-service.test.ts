import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DirongDatabase } from "../storage/sqlite.js";
import { NotionDashboardService } from "./dashboard-service.js";
import type { NotionClient } from "./client.js";
import { NotionRegistryStore } from "./registry-store.js";
import { KOREAN_NOTION_SCHEMA_PRESET } from "./schema-presets.js";
import {
  DEFAULT_NOTION_PROPERTY_NAMES,
  type NotionRuntimeSettings,
} from "./settings.js";
import { SqlRunner } from "../storage/sql-runner.js";

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

test("NotionDashboardService syncs member roster by semantic mappings with pagination", async () => {
  const fixture = createFixture();
  try {
    seedManagedRegistry(new NotionRegistryStore(new SqlRunner(fixture.database)));
    const client = new FakeNotionClient({
      memberPages: [
        memberPage("page-empty", "", ["UI"]),
        memberPage("page-taniar", "Taniar", ["UI"]),
        memberPage("page-taniar-dup", "Taniar", ["QA"]),
        memberPage("page-ari", "Ari", []),
      ],
    });
    const service = new NotionDashboardService({
      settings: notionSettings({
        apiKey: "ntn_test_dashboard_secret",
        targetUrl: null,
      }),
      notionClientFactory: () => client,
      database: fixture.database,
      config: { sttLeaseMs: 60000 },
      workerId: "notion-dashboard-test",
    });

    const result = await service.syncMemberRoster();
    const snapshot = service.getSnapshot().memberRoster;

    assert.equal(result.status, "done");
    assert.equal(result.memberCount, 3);
    assert.equal(result.roleCount, 2);
    assert.equal(
      result.warnings.filter((warning) => warning.code === "emptyDiscordName")
        .length,
      1,
    );
    assert.equal(
      result.warnings.filter((warning) => warning.code === "duplicateDiscordName")
        .length,
      1,
    );
    assert.deepEqual(client.queryBodies.map((body) => body.start_cursor ?? null), [
      null,
      "cursor-2",
    ]);
    assert.equal(snapshot.memberCount, 3);
    assert.equal(snapshot.roleCount, 2);
    assert.equal(snapshot.warningCount, 2);
  } finally {
    fixture.close();
  }
});

class FakeNotionClient implements NotionClient {
  readonly queryBodies: Record<string, unknown>[] = [];

  constructor(
    private readonly options: {
      memberPages?: readonly Record<string, unknown>[];
    } = {},
  ) {}

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

  async retrieveDataSource(dataSourceId = "01234567-89ab-cdef-0123-456789abcdef"): Promise<Record<string, unknown>> {
    if (dataSourceId === "member-data-source") {
      return {
        id: "member-data-source",
        name: "작업자",
        properties: {
          "디스코드 닉네임": { id: "member-discord-name-id", type: "title" },
          소속: { id: "member-organization-id", type: "select" },
          담당: { id: "member-roles-id", type: "multi_select" },
        },
      };
    }
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

  async queryDataSource(
    dataSourceId: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    this.queryBodies.push(body);
    if (dataSourceId === "member-data-source") {
      const pages = this.options.memberPages ?? [];
      if (body.start_cursor === "cursor-2") {
        return {
          results: pages.slice(2),
          has_more: false,
          next_cursor: null,
        };
      }
      return {
        results: pages.slice(0, 2),
        has_more: pages.length > 2,
        next_cursor: pages.length > 2 ? "cursor-2" : null,
      };
    }
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

function seedManagedRegistry(store: NotionRegistryStore): void {
  store.saveWorkspaceSettings({
    locale: "ko",
    parentPageUrl:
      "https://www.notion.so/workspace/Dirong-99999999999999999999999999999999",
    parentPageId: "99999999-9999-9999-9999-999999999999",
    nowIso: "2026-05-13T00:00:00.000Z",
  });
  store.upsertManagedDatabase({
    role: "member",
    locale: "ko",
    databaseId: "member-db",
    dataSourceId: "member-data-source",
    url: "https://notion.so/member-db",
    name: "작업자",
    createdByDirong: true,
    schemaVersion: "notion-managed-db-v1",
    nowIso: "2026-05-13T00:00:00.000Z",
  });
  for (const property of KOREAN_NOTION_SCHEMA_PRESET.databases.member.properties) {
    store.upsertPropertyMapping({
      databaseRole: "member",
      semanticKey: property.key,
      propertyName: property.name,
      propertyId: null,
      propertyType: property.type,
      locked: property.locked,
      sourceKind: "system",
      nowIso: "2026-05-13T00:00:00.000Z",
    });
  }
}

function memberPage(
  id: string,
  discordName: string,
  roles: readonly string[],
): Record<string, unknown> {
  return {
    id,
    last_edited_time: "2026-05-13T00:00:00.000Z",
    properties: {
      "디스코드 닉네임": {
        type: "title",
        title: [{ plain_text: discordName }],
      },
      소속: {
        type: "select",
        select: { name: "Product" },
      },
      담당: {
        type: "multi_select",
        multi_select: roles.map((name) => ({ name })),
      },
    },
  };
}
