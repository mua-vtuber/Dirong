import type {
  DirongLocalSettings,
} from "../settings/local-settings-store.js";
import { SqlRunner } from "../storage/sql-runner.js";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_PROJECT_ID,
  type DirongProjectRow,
  type DirongProjectStateRow,
  type NotionUploadScopeRow,
  type ProjectLifecycleStatus,
  type ProjectNotionUploadMode,
} from "./project-types.js";

export type BackfillDefaultProjectFromLegacySettingsInput = {
  settings: DirongLocalSettings;
  nowIso?: string;
};

export type BackfillDefaultProjectFromLegacySettingsResult = {
  project: DirongProjectRow;
  uploadScope: NotionUploadScopeRow;
  sessionBackfillCount: number;
};

export type CreateProjectInput = {
  id?: string;
  name?: string;
  lifecycleStatus?: Extract<ProjectLifecycleStatus, "draft" | "ready">;
  guildId?: string | null;
  guildName?: string | null;
  guildIconUrl?: string | null;
  commandEnabled?: boolean;
  notionTokenSecretRef?: string | null;
  notionParentPageUrl?: string | null;
  notionUploadMode?: ProjectNotionUploadMode;
  nowIso?: string;
};

export type UpdateProjectDiscordGuildInput = {
  projectId: string;
  guildId: string | null;
  guildName?: string | null;
  guildIconUrl?: string | null;
  commandEnabled?: boolean;
  nowIso?: string;
};

export type UpdateProjectNotionInput = {
  projectId: string;
  notionTokenSecretRef?: string | null;
  notionParentPageUrl?: string | null;
  notionUploadMode?: ProjectNotionUploadMode;
  nowIso?: string;
};

/**
 * Phase 2 boundary note:
 * Resolve the active/session project here first, then bind Notion stores behind
 * a project-scoped service. The current optional projectId store parameters are
 * legacy compatibility shims, not the intended UI/API calling convention.
 */
export class ProjectStore {
  constructor(private readonly runner: SqlRunner) {}

  listProjects(): DirongProjectRow[] {
    return this.runner.all<DirongProjectRow>(
      `SELECT *
       FROM dirong_projects
       ORDER BY
         CASE WHEN archived_at IS NULL THEN 0 ELSE 1 END ASC,
         created_at ASC,
         id ASC`,
    );
  }

  getProject(projectId: string): DirongProjectRow | null {
    return this.runner.get<DirongProjectRow>(
      "SELECT * FROM dirong_projects WHERE id = ?",
      cleanRequiredString(projectId, "project id"),
    );
  }

  getDefaultProject(): DirongProjectRow | null {
    return this.getProject(DEFAULT_PROJECT_ID);
  }

  getUploadScope(projectId: string): NotionUploadScopeRow | null {
    return this.runner.get<NotionUploadScopeRow>(
      "SELECT * FROM notion_upload_scope WHERE project_id = ?",
      cleanRequiredString(projectId, "project id"),
    );
  }

  getProjectState(): DirongProjectStateRow | null {
    return this.runner.get<DirongProjectStateRow>(
      "SELECT * FROM dirong_project_state WHERE id = 'default'",
    );
  }

  getActiveProjectId(): string | null {
    return this.getProjectState()?.active_project_id ?? null;
  }

  getActiveProject(): DirongProjectRow | null {
    const activeProjectId = this.getActiveProjectId();
    return activeProjectId ? this.getProject(activeProjectId) : null;
  }

  createDraftProject(input: Omit<CreateProjectInput, "lifecycleStatus"> = {}): DirongProjectRow {
    return this.createProject({ ...input, lifecycleStatus: "draft" });
  }

  createReadyProject(input: Omit<CreateProjectInput, "lifecycleStatus"> = {}): DirongProjectRow {
    return this.createProject({ ...input, lifecycleStatus: "ready" });
  }

  createProject(input: CreateProjectInput = {}): DirongProjectRow {
    const nowIso = input.nowIso ?? new Date().toISOString();
    const projectId = cleanProjectId(input.id ?? createProjectId());
    const lifecycleStatus = input.lifecycleStatus ?? "draft";
    const guildId = cleanNullableString(input.guildId ?? null);
    const notionTokenSecretRef = cleanNullableString(input.notionTokenSecretRef ?? null);
    const notionParentPageUrl = cleanNullableString(input.notionParentPageUrl ?? null);
    const notionUploadMode = input.notionUploadMode ?? "manual";

    this.runner.transaction(() => {
      this.assertGuildAvailable(guildId, projectId);
      this.runner.run(
        `INSERT INTO dirong_projects (
           id, name, lifecycle_status, guild_id, guild_name, guild_icon_url,
           command_enabled, notion_token_secret_ref, notion_parent_page_url,
           notion_upload_mode, created_at, updated_at, archived_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        projectId,
        cleanRequiredString(input.name ?? defaultProjectName(projectId), "project name"),
        lifecycleStatus,
        guildId,
        cleanNullableString(input.guildName ?? null),
        cleanNullableString(input.guildIconUrl ?? null),
        input.commandEnabled === false ? 0 : 1,
        notionTokenSecretRef,
        notionParentPageUrl,
        notionUploadMode,
        nowIso,
        nowIso,
      );
      this.ensureUploadScope(projectId, nowIso);
    });

    const project = this.getProject(projectId);
    if (!project) {
      throw new Error("Project row was not created.");
    }
    return project;
  }

  updateProjectDiscordGuildFields(
    input: UpdateProjectDiscordGuildInput,
  ): DirongProjectRow {
    const nowIso = input.nowIso ?? new Date().toISOString();
    const projectId = cleanRequiredString(input.projectId, "project id");
    const guildId = cleanNullableString(input.guildId);

    this.runner.transaction(() => {
      this.requireProject(projectId);
      this.assertGuildAvailable(guildId, projectId);
      this.runner.run(
        `UPDATE dirong_projects
         SET guild_id = ?,
             guild_name = ?,
             guild_icon_url = ?,
             command_enabled = COALESCE(?, command_enabled),
             updated_at = ?
         WHERE id = ?`,
        guildId,
        cleanNullableString(input.guildName ?? null),
        cleanNullableString(input.guildIconUrl ?? null),
        input.commandEnabled === undefined
          ? null
          : input.commandEnabled
            ? 1
            : 0,
        nowIso,
        projectId,
      );
    });

    return this.requireProject(projectId);
  }

  updateProjectNotionFields(input: UpdateProjectNotionInput): DirongProjectRow {
    const nowIso = input.nowIso ?? new Date().toISOString();
    const projectId = cleanRequiredString(input.projectId, "project id");
    const current = this.requireProject(projectId);
    const nextTokenSecretRef = hasOwn(input, "notionTokenSecretRef")
      ? cleanNullableString(input.notionTokenSecretRef ?? null)
      : current.notion_token_secret_ref;
    const nextParentPageUrl = hasOwn(input, "notionParentPageUrl")
      ? cleanNullableString(input.notionParentPageUrl ?? null)
      : current.notion_parent_page_url;
    const nextUploadMode = input.notionUploadMode ?? current.notion_upload_mode;

    this.runner.run(
      `UPDATE dirong_projects
       SET notion_token_secret_ref = ?,
           notion_parent_page_url = ?,
           notion_upload_mode = ?,
           updated_at = ?
       WHERE id = ?`,
      nextTokenSecretRef,
      nextParentPageUrl,
      nextUploadMode,
      nowIso,
      projectId,
    );

    return this.requireProject(projectId);
  }

  markProjectReady(projectId: string, nowIso = new Date().toISOString()): DirongProjectRow {
    return this.updateProjectLifecycle(projectId, "ready", nowIso);
  }

  markProjectDraft(projectId: string, nowIso = new Date().toISOString()): DirongProjectRow {
    return this.updateProjectLifecycle(projectId, "draft", nowIso);
  }

  markProjectResetting(
    projectId: string,
    nowIso = new Date().toISOString(),
  ): DirongProjectRow {
    return this.updateProjectLifecycle(projectId, "resetting", nowIso);
  }

  archiveProject(projectId: string, nowIso = new Date().toISOString()): DirongProjectRow {
    const cleanedProjectId = cleanRequiredString(projectId, "project id");
    this.runner.run(
      `UPDATE dirong_projects
       SET lifecycle_status = 'archived',
           command_enabled = 0,
           archived_at = COALESCE(archived_at, ?),
           updated_at = ?
       WHERE id = ?`,
      nowIso,
      nowIso,
      cleanedProjectId,
    );
    return this.requireProject(cleanedProjectId);
  }

  clearProjectConnectionForReset(
    projectId: string,
    nowIso = new Date().toISOString(),
  ): DirongProjectRow {
    const cleanedProjectId = cleanRequiredString(projectId, "project id");
    this.runner.run(
      `UPDATE dirong_projects
       SET lifecycle_status = 'draft',
           guild_id = NULL,
           guild_name = NULL,
           guild_icon_url = NULL,
           command_enabled = 1,
           notion_token_secret_ref = NULL,
           notion_parent_page_url = NULL,
           notion_upload_mode = 'manual',
           updated_at = ?
       WHERE id = ?`,
      nowIso,
      cleanedProjectId,
    );
    return this.requireProject(cleanedProjectId);
  }

  setActiveProjectId(
    projectId: string | null,
    nowIso = new Date().toISOString(),
  ): DirongProjectStateRow {
    const cleanedProjectId = projectId === null
      ? null
      : cleanRequiredString(projectId, "project id");
    if (cleanedProjectId) {
      this.requireProject(cleanedProjectId);
    }
    this.runner.run(
      `INSERT INTO dirong_project_state (
         id, active_project_id, switching, updated_at
       ) VALUES ('default', ?, 0, ?)
       ON CONFLICT(id) DO UPDATE SET
         active_project_id = excluded.active_project_id,
         switching = 0,
         updated_at = excluded.updated_at`,
      cleanedProjectId,
      nowIso,
    );
    const state = this.getProjectState();
    if (!state) {
      throw new Error("Active project state was not saved.");
    }
    return state;
  }

  setProjectSwitching(
    switching: boolean,
    nowIso = new Date().toISOString(),
  ): DirongProjectStateRow {
    this.runner.run(
      `INSERT INTO dirong_project_state (
         id, active_project_id, switching, updated_at
       ) VALUES ('default', NULL, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         switching = excluded.switching,
         updated_at = excluded.updated_at`,
      switching ? 1 : 0,
      nowIso,
    );
    const state = this.getProjectState();
    if (!state) {
      throw new Error("Active project state was not saved.");
    }
    return state;
  }

  backfillDefaultProjectFromLegacySettings(
    input: BackfillDefaultProjectFromLegacySettingsInput,
  ): BackfillDefaultProjectFromLegacySettingsResult {
    const nowIso = input.nowIso ?? new Date().toISOString();
    let sessionBackfillCount = 0;

    this.runner.transaction(() => {
      const current = this.getDefaultProject();
      const legacy = readLegacySettingsBackfill(input.settings);
      const shouldCopyNotionUploadMode = Boolean(
        legacy.notionUploadMode &&
          (legacy.notionTokenSecretRef || legacy.notionParentPageUrl) &&
          (!current ||
            !current.notion_token_secret_ref ||
            !current.notion_parent_page_url),
      );
      const nextGuildId = current?.guild_id ?? legacy.guildId;
      const nextTokenSecretRef =
        current?.notion_token_secret_ref ?? legacy.notionTokenSecretRef;
      const nextParentPageUrl =
        current?.notion_parent_page_url ?? legacy.notionParentPageUrl;
      const nextUploadMode = shouldCopyNotionUploadMode
        ? legacy.notionUploadMode
        : current?.notion_upload_mode ?? legacy.notionUploadMode ?? "manual";
      const hasBoundaryConfig = Boolean(
        nextGuildId || nextTokenSecretRef || nextParentPageUrl,
      );
      const lifecycleStatus =
        current?.lifecycle_status === "archived" ||
        current?.lifecycle_status === "resetting"
          ? current.lifecycle_status
          : hasBoundaryConfig
            ? "ready"
            : current?.lifecycle_status ?? "draft";

      this.runner.run(
        `INSERT INTO dirong_projects (
           id, name, lifecycle_status, guild_id, guild_name, guild_icon_url,
           command_enabled, notion_token_secret_ref, notion_parent_page_url,
           notion_upload_mode, created_at, updated_at, archived_at
         ) VALUES (
           ?, ?, ?, ?, NULL, NULL, 1, ?, ?, ?, ?, ?, NULL
         )
         ON CONFLICT(id) DO UPDATE SET
           lifecycle_status = excluded.lifecycle_status,
           guild_id = COALESCE(dirong_projects.guild_id, excluded.guild_id),
           notion_token_secret_ref = COALESCE(
             dirong_projects.notion_token_secret_ref,
             excluded.notion_token_secret_ref
           ),
           notion_parent_page_url = COALESCE(
             dirong_projects.notion_parent_page_url,
             excluded.notion_parent_page_url
           ),
           notion_upload_mode = ?,
           updated_at = excluded.updated_at`,
        DEFAULT_PROJECT_ID,
        current?.name ?? "Default Project",
        lifecycleStatus,
        nextGuildId,
        nextTokenSecretRef,
        nextParentPageUrl,
        nextUploadMode,
        current?.created_at ?? nowIso,
        nowIso,
        nextUploadMode,
      );

      this.runner.run(
        `INSERT INTO dirong_project_state (
           id, active_project_id, switching, updated_at
         ) VALUES ('default', ?, 0, ?)
         ON CONFLICT(id) DO UPDATE SET
           active_project_id = COALESCE(
             dirong_project_state.active_project_id,
             excluded.active_project_id
           ),
           switching = 0,
           updated_at = excluded.updated_at`,
        DEFAULT_PROJECT_ID,
        nowIso,
      );

      this.runner.run(
        `INSERT INTO notion_upload_scope (
           project_id, automatic_upload_after, reset_mode, reset_at, updated_at
         ) VALUES (?, '1970-01-01T00:00:00.000Z', NULL, NULL, ?)
         ON CONFLICT(project_id) DO NOTHING`,
        DEFAULT_PROJECT_ID,
        nowIso,
      );

      if (nextGuildId) {
        sessionBackfillCount = this.runner.run(
          `UPDATE sessions
           SET project_id = ?
           WHERE project_id IS NULL
             AND guild_id = ?`,
          DEFAULT_PROJECT_ID,
          nextGuildId,
        );
      }
    });

    const project = this.getDefaultProject();
    const uploadScope = this.getUploadScope(DEFAULT_PROJECT_ID);
    if (!project || !uploadScope) {
      throw new Error("Default project bootstrap failed.");
    }
    return { project, uploadScope, sessionBackfillCount };
  }

  private ensureUploadScope(projectId: string, nowIso: string): void {
    this.runner.run(
      `INSERT INTO notion_upload_scope (
         project_id, automatic_upload_after, reset_mode, reset_at, updated_at
       ) VALUES (?, '1970-01-01T00:00:00.000Z', NULL, NULL, ?)
       ON CONFLICT(project_id) DO NOTHING`,
      projectId,
      nowIso,
    );
  }

  private requireProject(projectId: string): DirongProjectRow {
    const project = this.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    return project;
  }

  private updateProjectLifecycle(
    projectId: string,
    lifecycleStatus: ProjectLifecycleStatus,
    nowIso: string,
  ): DirongProjectRow {
    const cleanedProjectId = cleanRequiredString(projectId, "project id");
    this.runner.run(
      `UPDATE dirong_projects
       SET lifecycle_status = ?,
           updated_at = ?
       WHERE id = ?`,
      lifecycleStatus,
      nowIso,
      cleanedProjectId,
    );
    return this.requireProject(cleanedProjectId);
  }

  private assertGuildAvailable(guildId: string | null, projectId: string): void {
    if (!guildId) {
      return;
    }
    const existing = this.runner.get<{ id: string }>(
      `SELECT id
       FROM dirong_projects
       WHERE guild_id = ?
         AND archived_at IS NULL
         AND id <> ?
       LIMIT 1`,
      guildId,
      projectId,
    );
    if (existing) {
      throw new Error(
        `Discord guild ${guildId} is already assigned to project ${existing.id}.`,
      );
    }
  }
}

function readLegacySettingsBackfill(settings: DirongLocalSettings): {
  guildId: string | null;
  notionTokenSecretRef: string | null;
  notionParentPageUrl: string | null;
  notionUploadMode: "manual" | "automatic_after_ai_cleanup" | null;
} {
  return {
    guildId: cleanOptionalString(settings.discord.guildIds?.[0]),
    notionTokenSecretRef: cleanOptionalString(settings.notion.tokenSecretRef),
    notionParentPageUrl: cleanOptionalString(settings.notion.parentPageUrl),
    notionUploadMode: settings.notion.uploadMode ?? null,
  };
}

function cleanOptionalString(value: string | undefined): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function cleanRequiredString(value: string, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
  const cleaned = value.trim();
  if (!cleaned) {
    throw new Error(`${label} must not be empty.`);
  }
  return cleaned;
}

function cleanNullableString(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error("nullable project string must be a string or null.");
  }
  const cleaned = value.trim();
  return cleaned || null;
}

function cleanProjectId(value: string): string {
  const cleaned = cleanRequiredString(value, "project id");
  if (!/^[a-z0-9._:-]{1,80}$/i.test(cleaned)) {
    throw new Error("project id contains unsupported characters.");
  }
  return cleaned;
}

function createProjectId(): string {
  return `project_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

function defaultProjectName(projectId: string): string {
  return projectId === DEFAULT_PROJECT_ID ? "Default Project" : "Untitled Project";
}

function hasOwn<T extends object, K extends PropertyKey>(
  value: T,
  key: K,
): value is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key);
}
