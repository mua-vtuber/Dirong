import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SqlRunner } from "../storage/sql-runner.js";
import { DirongDatabase } from "../storage/sqlite.js";
import { ProjectStore } from "../projects/project-store.js";
import {
  DEFAULT_NOTION_WORKSPACE_SETTINGS_ID,
  NotionRegistryStore,
} from "./registry-store.js";

const nowIso = "2026-05-10T00:00:00.000Z";
const laterIso = "2026-05-10T00:01:00.000Z";

test("NotionRegistryStore saves and reads workspace settings", () => {
  const fixture = createFixture();
  try {
    const saved = fixture.store.saveWorkspaceSettings({
      locale: "ko",
      parentPageUrl: "https://www.notion.so/workspace/Dirong-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      parentPageId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      nowIso,
    });

    assert.deepEqual(saved, {
      projectId: "default",
      id: DEFAULT_NOTION_WORKSPACE_SETTINGS_ID,
      locale: "ko",
      parentPageUrl:
        "https://www.notion.so/workspace/Dirong-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      parentPageId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    const updated = fixture.store.saveWorkspaceSettings({
      locale: "ko",
      parentPageUrl: "https://www.notion.so/workspace/Dirong-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      parentPageId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      nowIso: laterIso,
    });

    assert.equal(updated.createdAt, nowIso);
    assert.equal(updated.updatedAt, laterIso);
    assert.equal(
      fixture.store.getWorkspaceSettings()?.parentPageId,
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    );
  } finally {
    fixture.close();
  }
});

test("NotionRegistryStore upserts, lists, and reads managed databases by role", () => {
  const fixture = createFixture();
  try {
    fixture.store.upsertManagedDatabase({
      role: "meeting",
      locale: "ko",
      databaseId: "meeting-db",
      dataSourceId: "meeting-ds",
      url: "https://notion.so/meeting",
      name: "회의록",
      createdByDirong: true,
      schemaVersion: "notion-managed-db-v1",
      nowIso,
    });
    fixture.store.upsertManagedDatabase({
      role: "member",
      locale: "ko",
      databaseId: "member-db",
      dataSourceId: "member-ds",
      url: "https://notion.so/member",
      name: "작업자",
      createdByDirong: true,
      schemaVersion: "notion-managed-db-v1",
      nowIso,
    });

    const updated = fixture.store.upsertManagedDatabase({
      role: "meeting",
      locale: "ko",
      databaseId: "meeting-db-2",
      dataSourceId: "meeting-ds-2",
      url: "https://notion.so/meeting-2",
      name: "회의록 v2",
      createdByDirong: false,
      schemaVersion: "notion-managed-db-v2",
      nowIso: laterIso,
    });

    assert.equal(updated.createdAt, nowIso);
    assert.equal(updated.updatedAt, laterIso);
    assert.equal(updated.databaseId, "meeting-db-2");
    assert.equal(updated.createdByDirong, false);
    assert.deepEqual(
      fixture.store.listManagedDatabases().map((database) => database.role),
      ["meeting", "member"],
    );
    assert.equal(
      fixture.store.getManagedDatabase("member")?.dataSourceId,
      "member-ds",
    );
  } finally {
    fixture.close();
  }
});

test("NotionRegistryStore isolates managed registry rows by project id", () => {
  const fixture = createFixture();
  try {
    fixture.projectStore.createDraftProject({ id: "project-a", nowIso });
    fixture.projectStore.createDraftProject({ id: "project-b", nowIso });
    fixture.store.upsertManagedDatabase({
      projectId: "project-a",
      role: "meeting",
      locale: "ko",
      databaseId: "meeting-db-a",
      dataSourceId: "meeting-ds-a",
      url: "https://notion.so/meeting-a",
      name: "회의록 A",
      createdByDirong: true,
      schemaVersion: "notion-managed-db-v1",
      nowIso,
    });
    fixture.store.upsertManagedDatabase({
      projectId: "project-b",
      role: "meeting",
      locale: "ko",
      databaseId: "meeting-db-b",
      dataSourceId: "meeting-ds-b",
      url: "https://notion.so/meeting-b",
      name: "회의록 B",
      createdByDirong: true,
      schemaVersion: "notion-managed-db-v1",
      nowIso,
    });

    assert.equal(
      fixture.store.getManagedDatabase("meeting", "project-a")?.dataSourceId,
      "meeting-ds-a",
    );
    assert.equal(
      fixture.store.getManagedDatabase("meeting", "project-b")?.dataSourceId,
      "meeting-ds-b",
    );
    assert.deepEqual(
      fixture.store.listManagedDatabases("project-a").map((row) => row.dataSourceId),
      ["meeting-ds-a"],
    );
    assert.equal(fixture.store.getManagedDatabase("meeting"), null);
  } finally {
    fixture.close();
  }
});

test("NotionRegistryStore replaces property mappings for one database role", () => {
  const fixture = createFixture();
  try {
    fixture.store.upsertPropertyMapping({
      databaseRole: "task",
      semanticKey: "task.title",
      propertyName: "작업",
      propertyId: "task-title",
      propertyType: "title",
      locked: true,
      sourceKind: "system",
      nowIso,
    });
    fixture.store.replacePropertyMappingsForDatabaseRole({
      databaseRole: "meeting",
      mappings: [
        {
          semanticKey: "meeting.title",
          propertyName: "회의록",
          propertyId: "meeting-title",
          propertyType: "title",
          locked: true,
          sourceKind: "system",
        },
        {
          semanticKey: "meeting.participants",
          propertyName: "참가자",
          propertyId: "meeting-participants",
          propertyType: "rollup",
          locked: true,
          sourceKind: "rollup",
        },
      ],
      nowIso,
    });

    const replaced = fixture.store.replacePropertyMappingsForDatabaseRole({
      databaseRole: "meeting",
      mappings: [
        {
          semanticKey: "meeting.date",
          propertyName: "날짜",
          propertyId: "meeting-date",
          propertyType: "date",
          locked: true,
          sourceKind: "system",
        },
      ],
      nowIso: laterIso,
    });

    assert.deepEqual(
      replaced.map((mapping) => ({
        databaseRole: mapping.databaseRole,
        semanticKey: mapping.semanticKey,
        propertyName: mapping.propertyName,
        propertyId: mapping.propertyId,
      })),
      [
        {
          databaseRole: "meeting",
          semanticKey: "meeting.date",
          propertyName: "날짜",
          propertyId: "meeting-date",
        },
      ],
    );
    assert.equal(
      fixture.store.getPropertyMapping("meeting", "meeting.title"),
      null,
    );
    assert.equal(
      fixture.store.getPropertyMapping("task", "task.title")?.propertyName,
      "작업",
    );
    assert.deepEqual(
      fixture.store.listPropertyMappings().map((mapping) => mapping.semanticKey),
      ["meeting.date", "task.title"],
    );
  } finally {
    fixture.close();
  }
});

test("NotionRegistryStore rejects invalid locale, role, and semantic key input", () => {
  const fixture = createFixture();
  try {
    assert.throws(
      () =>
        fixture.store.saveWorkspaceSettings({
          locale: "ja" as never,
          parentPageUrl: "https://notion.so/parent",
          parentPageId: "parent-id",
          nowIso,
        }),
      /Invalid Notion locale/,
    );

    assert.throws(
      () =>
        fixture.store.upsertManagedDatabase({
          role: "project" as never,
          locale: "ko",
          databaseId: "db",
          dataSourceId: "ds",
          url: "https://notion.so/db",
          name: "DB",
          createdByDirong: true,
          schemaVersion: "v1",
          nowIso,
        }),
      /Invalid Notion database role/,
    );

    assert.throws(
      () =>
        fixture.store.upsertPropertyMapping({
          databaseRole: "meeting",
          semanticKey: "meeting.unknown" as never,
          propertyName: "Unknown",
          propertyId: null,
          propertyType: "rich_text",
          locked: true,
          sourceKind: "system",
          nowIso,
        }),
      /Invalid Notion property semantic key/,
    );

    assert.throws(
      () =>
        fixture.store.upsertPropertyMapping({
          databaseRole: "meeting",
          semanticKey: "task.title",
          propertyName: "작업",
          propertyId: "task-title",
          propertyType: "title",
          locked: true,
          sourceKind: "system",
          nowIso,
        }),
      /for meeting database/,
    );
  } finally {
    fixture.close();
  }
});

function createFixture(): {
  store: NotionRegistryStore;
  projectStore: ProjectStore;
  close: () => void;
} {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-notion-registry-"));
  const database = new DirongDatabase(path.join(dir, "dirong.sqlite"), 1000);
  const runner = new SqlRunner(database);
  const projectStore = new ProjectStore(runner);
  return {
    store: new NotionRegistryStore(runner),
    projectStore,
    close: () => {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
