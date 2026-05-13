import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { NotionClient } from "./client.js";
import { syncNotionMemberRoster } from "./member-roster-sync.js";
import { NotionMemberRosterStore } from "./member-roster-store.js";
import { NotionRegistryStore } from "./registry-store.js";
import { ProjectStore } from "../projects/project-store.js";
import { SqlRunner } from "../storage/sql-runner.js";
import { DirongDatabase } from "../storage/sqlite.js";

const nowIso = "2026-05-13T00:00:00.000Z";

test("syncNotionMemberRoster stores roster rows in the requested project scope", async () => {
  const fixture = createFixture();
  try {
    fixture.projectStore.createDraftProject({ id: "project-a", nowIso });
    fixture.projectStore.createDraftProject({ id: "project-b", nowIso });
    seedMemberRegistry(fixture.registryStore, "project-a", "member-ds-a");
    seedMemberRegistry(fixture.registryStore, "project-b", "member-ds-b");
    fixture.rosterStore.replaceForDataSource({
      projectId: "project-b",
      dataSourceId: "member-ds-b",
      entries: [
        {
          pageId: "shared-page",
          discordName: "Project B User",
          roles: ["reviewer"],
        },
      ],
      syncedAt: nowIso,
      warningCount: 0,
    });

    const result = await syncNotionMemberRoster({
      client: makeRosterClient("member-ds-a", "Project A User"),
      registryStore: fixture.registryStore,
      rosterStore: fixture.rosterStore,
      projectId: "project-a",
      nowIso,
    });

    assert.equal(result.ok, true);
    assert.equal(result.dataSourceId, "member-ds-a");
    assert.deepEqual(
      fixture.rosterStore
        .listForDataSource("member-ds-a", "project-a")
        .map((entry) => ({
          projectId: entry.projectId,
          pageId: entry.pageId,
          discordName: entry.discordName,
        })),
      [
        {
          projectId: "project-a",
          pageId: "shared-page",
          discordName: "Project A User",
        },
      ],
    );
    assert.deepEqual(
      fixture.rosterStore
        .listForDataSource("member-ds-b", "project-b")
        .map((entry) => ({
          projectId: entry.projectId,
          pageId: entry.pageId,
          discordName: entry.discordName,
        })),
      [
        {
          projectId: "project-b",
          pageId: "shared-page",
          discordName: "Project B User",
        },
      ],
    );
    assert.equal(
      fixture.rosterStore.getSyncSnapshot("member-ds-a", "project-b"),
      null,
    );
  } finally {
    fixture.close();
  }
});

test("NotionMemberRosterStore clearProject removes entries and sync snapshots by project", () => {
  const fixture = createFixture();
  try {
    fixture.projectStore.createDraftProject({ id: "project-a", nowIso });
    fixture.projectStore.createDraftProject({ id: "project-b", nowIso });
    fixture.rosterStore.replaceForDataSource({
      projectId: "project-a",
      dataSourceId: "member-ds",
      entries: [{ pageId: "page-a", discordName: "A", roles: ["owner"] }],
      syncedAt: nowIso,
      warningCount: 0,
    });
    fixture.rosterStore.replaceForDataSource({
      projectId: "project-b",
      dataSourceId: "member-ds",
      entries: [{ pageId: "page-b", discordName: "B", roles: ["owner"] }],
      syncedAt: nowIso,
      warningCount: 0,
    });

    assert.deepEqual(fixture.rosterStore.clearProject("project-a"), {
      entries: 1,
      syncs: 1,
    });
    assert.deepEqual(fixture.rosterStore.listForDataSource("member-ds", "project-a"), []);
    assert.equal(
      fixture.rosterStore.listForDataSource("member-ds", "project-b")[0]?.discordName,
      "B",
    );
  } finally {
    fixture.close();
  }
});

function seedMemberRegistry(
  store: NotionRegistryStore,
  projectId: string,
  dataSourceId: string,
): void {
  store.upsertManagedDatabase({
    projectId,
    role: "member",
    locale: "ko",
    databaseId: `database-${projectId}`,
    dataSourceId,
    url: `https://notion.so/${dataSourceId}`,
    name: `Members ${projectId}`,
    createdByDirong: true,
    schemaVersion: "notion-managed-db-v1",
    nowIso,
  });
  store.upsertPropertyMapping({
    projectId,
    databaseRole: "member",
    semanticKey: "member.discordName",
    propertyName: "Discord",
    propertyId: "discord-id",
    propertyType: "title",
    locked: true,
    sourceKind: "system",
    nowIso,
  });
}

function makeRosterClient(
  expectedDataSourceId: string,
  discordName: string,
): NotionClient {
  const unsupported = async (): Promise<Record<string, unknown>> => {
    throw new Error("Unexpected Notion client call in roster sync test.");
  };
  return {
    retrievePage: unsupported,
    retrieveDatabase: unsupported,
    createDatabase: unsupported,
    createDataSource: unsupported,
    updateDataSource: unsupported,
    createPage: unsupported,
    updatePage: unsupported,
    appendBlockChildren: unsupported,
    retrieveBlockChildren: unsupported,
    async retrieveDataSource(dataSourceId) {
      assert.equal(dataSourceId, expectedDataSourceId);
      return {
        id: dataSourceId,
        properties: {
          Discord: { id: "discord-id", name: "Discord", type: "title" },
        },
      };
    },
    async queryDataSource(dataSourceId) {
      assert.equal(dataSourceId, expectedDataSourceId);
      return {
        results: [
          {
            id: "shared-page",
            last_edited_time: nowIso,
            properties: {
              Discord: {
                type: "title",
                title: [{ plain_text: discordName }],
              },
            },
          },
        ],
        has_more: false,
        next_cursor: null,
      };
    },
  };
}

function createFixture(): {
  registryStore: NotionRegistryStore;
  rosterStore: NotionMemberRosterStore;
  projectStore: ProjectStore;
  close: () => void;
} {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-member-roster-sync-"));
  const database = new DirongDatabase(path.join(dir, "dirong.sqlite"), 1000);
  const runner = new SqlRunner(database);
  return {
    registryStore: new NotionRegistryStore(runner),
    rosterStore: new NotionMemberRosterStore(runner),
    projectStore: new ProjectStore(runner),
    close: () => {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
