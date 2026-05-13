import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { DirongLocalSettings } from "../settings/local-settings-store.js";
import { SqlRunner } from "../storage/sql-runner.js";
import { DirongDatabase } from "../storage/sqlite.js";
import { ProjectStore } from "./project-store.js";

const nowIso = "2026-05-13T00:00:00.000Z";

test("ProjectStore backfills default project from legacy local settings idempotently", () => {
  const fixture = createFixture();
  try {
    insertSession(fixture.database, {
      id: "session-default-guild",
      guildId: "guild-from-settings",
    });
    insertSession(fixture.database, {
      id: "session-other-guild",
      guildId: "guild-other",
    });

    const store = new ProjectStore(fixture.runner);
    store.backfillDefaultProjectFromLegacySettings({
      settings: legacySettings({
        guildIds: ["guild-from-settings", "guild-other"],
        notionTokenSecretRef: "notion.internal_connection_token",
        notionParentPageUrl: "https://notion.so/settings-parent",
        notionUploadMode: "automatic_after_ai_cleanup",
      }),
      nowIso,
    });
    store.backfillDefaultProjectFromLegacySettings({
      settings: legacySettings({
        guildIds: ["guild-replacement"],
        notionTokenSecretRef: "notion.replacement",
        notionParentPageUrl: "https://notion.so/replacement",
        notionUploadMode: "manual",
      }),
      nowIso: "2026-05-13T00:01:00.000Z",
    });

    assert.deepEqual(
      readDefaultProject(fixture.database),
      {
        id: "default",
        lifecycle_status: "ready",
        guild_id: "guild-from-settings",
        notion_token_secret_ref: "notion.internal_connection_token",
        notion_parent_page_url: "https://notion.so/settings-parent",
        notion_upload_mode: "automatic_after_ai_cleanup",
      },
    );
    assert.deepEqual(
      readSessionProjects(fixture.database),
      [
        { id: "session-default-guild", project_id: "default" },
        { id: "session-other-guild", project_id: null },
      ],
    );
    assert.deepEqual(readActiveProjectState(fixture.database), {
      id: "default",
      active_project_id: "default",
      switching: 0,
    });
    assert.deepEqual(readDefaultUploadScope(fixture.database), {
      project_id: "default",
      automatic_upload_after: "1970-01-01T00:00:00.000Z",
    });
  } finally {
    fixture.close();
  }
});

test("ProjectStore creates, lists, updates, archives, and switches active projects", () => {
  const fixture = createFixture();
  try {
    const store = new ProjectStore(fixture.runner);
    const draft = store.createDraftProject({
      id: "project-alpha",
      name: "Alpha",
      nowIso,
    });
    const ready = store.createReadyProject({
      id: "project-beta",
      name: "Beta",
      guildId: "222222222222222222",
      notionTokenSecretRef: "notion.project.project-beta.token",
      notionParentPageUrl: "https://notion.so/beta",
      notionUploadMode: "automatic_after_ai_cleanup",
      nowIso,
    });

    assert.equal(draft.lifecycle_status, "draft");
    assert.equal(ready.lifecycle_status, "ready");
    assert.deepEqual(
      store.listProjects().map((project) => project.id),
      ["project-alpha", "project-beta", "default"],
    );

    const updatedGuild = store.updateProjectDiscordGuildFields({
      projectId: "project-alpha",
      guildId: "111111111111111111",
      guildName: "Alpha Guild",
      guildIconUrl: "https://cdn.example/icon.png",
      nowIso: "2026-05-13T00:01:00.000Z",
    });
    assert.equal(updatedGuild.guild_id, "111111111111111111");
    assert.equal(updatedGuild.guild_name, "Alpha Guild");

    const renamed = store.updateProjectName({
      projectId: "project-alpha",
      name: "Alpha Renamed",
      nowIso: "2026-05-13T00:01:30.000Z",
    });
    assert.equal(renamed.name, "Alpha Renamed");
    assert.equal(renamed.updated_at, "2026-05-13T00:01:30.000Z");

    assert.throws(
      () =>
        store.updateProjectDiscordGuildFields({
          projectId: "project-beta",
          guildId: "111111111111111111",
          nowIso,
        }),
      /already assigned/,
    );

    const updatedNotion = store.updateProjectNotionFields({
      projectId: "project-alpha",
      notionTokenSecretRef: "notion.project.project-alpha.token",
      notionParentPageUrl: "https://notion.so/alpha",
      notionUploadMode: "automatic_after_ai_cleanup",
      nowIso,
    });
    assert.equal(
      updatedNotion.notion_token_secret_ref,
      "notion.project.project-alpha.token",
    );
    assert.equal(updatedNotion.notion_upload_mode, "automatic_after_ai_cleanup");

    store.setActiveProjectId("project-alpha", nowIso);
    assert.equal(store.getActiveProjectId(), "project-alpha");
    assert.equal(store.getActiveProject()?.name, "Alpha Renamed");

    const archived = store.archiveProject("project-alpha", nowIso);
    assert.equal(archived.lifecycle_status, "archived");
    assert.equal(archived.command_enabled, 0);

    const replacement = store.createDraftProject({
      id: "project-alpha-replacement",
      guildId: "111111111111111111",
      nowIso,
    });
    assert.equal(replacement.guild_id, "111111111111111111");
  } finally {
    fixture.close();
  }
});

test("ProjectStore reset helpers archive history projects and create fresh active drafts", () => {
  const fixture = createFixture();
  try {
    const store = new ProjectStore(fixture.runner);
    store.createReadyProject({
      id: "project-history",
      name: "History",
      guildId: "111111111111111111",
      notionTokenSecretRef: "notion.project.project-history.token",
      notionParentPageUrl: "https://notion.so/history",
      nowIso,
    });
    store.setActiveProjectId("project-history", nowIso);
    insertSession(fixture.database, {
      id: "session-history",
      guildId: "111111111111111111",
      projectId: "project-history",
    });

    const reset = store.resetCurrentProjectConnection({
      projectId: "project-history",
      nowIso: laterIso(),
    });

    assert.equal(reset.strategy, "archive_and_replace");
    assert.equal(reset.archivedProjectId, "project-history");
    assert.equal(reset.project.lifecycle_status, "draft");
    assert.equal(reset.project.guild_id, null);
    assert.equal(store.getActiveProjectId(), reset.project.id);
    const archived = store.getProject("project-history");
    assert.equal(archived?.lifecycle_status, "archived");
    assert.equal(archived?.guild_id, null);
    assert.equal(archived?.notion_token_secret_ref, null);
    assert.equal(
      store.getUploadScope("project-history")?.automatic_upload_after,
      laterIso(),
    );
  } finally {
    fixture.close();
  }
});

test("ProjectStore full reset clears all project connections", () => {
  const fixture = createFixture();
  try {
    const store = new ProjectStore(fixture.runner);
    store.createReadyProject({
      id: "project-a",
      guildId: "111111111111111111",
      notionTokenSecretRef: "notion.project.project-a.token",
      notionParentPageUrl: "https://notion.so/a",
      nowIso,
    });
    store.createReadyProject({
      id: "project-b",
      guildId: "222222222222222222",
      notionTokenSecretRef: "notion.project.project-b.token",
      notionParentPageUrl: "https://notion.so/b",
      nowIso,
    });
    store.setActiveProjectId("project-a", nowIso);

    const reset = store.resetAllProjectConnectionsForFullReset(laterIso());

    assert.equal(reset.project.lifecycle_status, "draft");
    assert.equal(store.getActiveProjectId(), reset.project.id);
    assert.deepEqual(reset.archivedProjectIds.sort(), ["default", "project-a", "project-b"]);
    for (const projectId of ["project-a", "project-b"]) {
      const archived = store.getProject(projectId);
      assert.equal(archived?.lifecycle_status, "archived");
      assert.equal(archived?.guild_id, null);
      assert.equal(archived?.notion_token_secret_ref, null);
      assert.equal(
        store.getUploadScope(projectId)?.automatic_upload_after,
        laterIso(),
      );
    }
  } finally {
    fixture.close();
  }
});

type Fixture = {
  dir: string;
  database: DirongDatabase;
  runner: SqlRunner;
  close: () => void;
};

function createFixture(): Fixture {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-project-store-"));
  const database = new DirongDatabase(path.join(dir, "dirong.sqlite"), 1000);
  return {
    dir,
    database,
    runner: new SqlRunner(database),
    close: () => {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function legacySettings(input: {
  guildIds: string[];
  notionTokenSecretRef: string;
  notionParentPageUrl: string;
  notionUploadMode: "manual" | "automatic_after_ai_cleanup";
}): DirongLocalSettings {
  return {
    schemaVersion: 1,
    app: { locale: "ko", dashboardTheme: "system" },
    discord: {
      guildIds: input.guildIds,
    },
    stt: {},
    ai: {},
    notion: {
      tokenSecretRef: input.notionTokenSecretRef,
      parentPageUrl: input.notionParentPageUrl,
      uploadMode: input.notionUploadMode,
    },
    recording: {},
    retention: {},
  };
}

function insertSession(
  database: DirongDatabase,
  input: { id: string; guildId: string; projectId?: string | null },
): void {
  database.db
    .prepare(
      `INSERT INTO sessions (
         id, project_id, guild_id, guild_name, text_channel_id, voice_channel_id,
         voice_channel_name, started_by_user_id, started_by_display_name,
         stopped_by_user_id, stopped_by_display_name, status, started_at,
         stopped_at, finalized_at, data_dir, last_error, created_at, updated_at
       ) VALUES (
         ?, ?, ?, 'Guild', 'text', 'voice', 'Voice', 'starter', 'Taniar',
         NULL, NULL, 'finalized', ?, ?, ?, ?, NULL, ?, ?
       )`,
    )
    .run(
      input.id,
      input.projectId ?? null,
      input.guildId,
      nowIso,
      nowIso,
      nowIso,
      path.dirname(database.dbPath),
      nowIso,
      nowIso,
    );
}

function laterIso(): string {
  return "2026-05-13T00:01:00.000Z";
}

function readDefaultProject(
  database: DirongDatabase,
): Record<string, unknown> | null {
  const row = database.db
    .prepare(
      `SELECT id, lifecycle_status, guild_id, notion_token_secret_ref,
              notion_parent_page_url, notion_upload_mode
       FROM dirong_projects
       WHERE id = 'default'`,
    )
    .get();
  return row ? { ...(row as Record<string, unknown>) } : null;
}

function readSessionProjects(
  database: DirongDatabase,
): Array<Record<string, unknown>> {
  return database.db
    .prepare("SELECT id, project_id FROM sessions ORDER BY id")
    .all()
    .map((row) => ({ ...(row as Record<string, unknown>) }));
}

function readActiveProjectState(
  database: DirongDatabase,
): Record<string, unknown> | null {
  const row = database.db
    .prepare("SELECT id, active_project_id, switching FROM dirong_project_state")
    .get();
  return row ? { ...(row as Record<string, unknown>) } : null;
}

function readDefaultUploadScope(
  database: DirongDatabase,
): Record<string, unknown> | null {
  const row = database.db
    .prepare(
      `SELECT project_id, automatic_upload_after
       FROM notion_upload_scope
       WHERE project_id = 'default'`,
    )
    .get();
  return row ? { ...(row as Record<string, unknown>) } : null;
}
