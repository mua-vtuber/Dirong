import type { IncomingMessage, ServerResponse } from "node:http";
import { redactForJson } from "../errors.js";
import {
  isRecord,
  readJsonBody,
  sendJson,
  withMessageKeys,
} from "./http.js";
import type {
  DashboardProjectsCreateDraftInput,
  DashboardProjectsSource,
  DashboardRuntimeSources,
} from "./server.js";
import type { ActiveProjectSwitchResult } from "../projects/active-project-service.js";
import type { DirongProjectRow } from "../projects/project-types.js";
import { getDashboardResponseLocale } from "./setup-routes.js";

export type DashboardProjectSnapshot = {
  id: string;
  name: string;
  lifecycleStatus: DirongProjectRow["lifecycle_status"];
  guildId: string | null;
  guildName: string | null;
  guildIconUrl: string | null;
  commandEnabled: boolean;
  notionConnectionConfigured: boolean;
  notionParentPageConfigured: boolean;
  notionUploadMode: DirongProjectRow["notion_upload_mode"];
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type DashboardProjectsSnapshot = {
  ok: true;
  status: "ready";
  projects: DashboardProjectSnapshot[];
  activeProject: DashboardProjectSnapshot | null;
  activeProjectId: string | null;
};

export function buildDashboardProjectsSnapshot(
  projectsSource: DashboardProjectsSource,
): DashboardProjectsSnapshot {
  const activeProject = projectsSource.getActiveProject();
  return {
    ok: true,
    status: "ready",
    projects: projectsSource.listProjects().map(projectRowToSnapshot),
    activeProject: projectToSnapshot(activeProject),
    activeProjectId: activeProject?.id ?? null,
  };
}

export function handleProjectsListGet(
  response: ServerResponse,
  sources: DashboardRuntimeSources,
): void {
  const locale = getDashboardResponseLocale(sources);
  if (!sources.projects) {
    sendJson(response, withMessageKeys(locale, {
      ok: false,
      status: "not_configured",
      messageKey: "error.dashboard.setupStatusSourceMissing.message",
      userActionKey: "error.dashboard.setupStatusSourceMissing.action",
      projects: [],
      activeProject: null,
      activeProjectId: null,
    }), 500);
    return;
  }

  sendJson(response, buildDashboardProjectsSnapshot(sources.projects));
}

export function handleActiveProjectGet(
  response: ServerResponse,
  sources: DashboardRuntimeSources,
): void {
  const locale = getDashboardResponseLocale(sources);
  if (!sources.projects) {
    sendJson(response, withMessageKeys(locale, {
      ok: false,
      status: "not_configured",
      messageKey: "error.dashboard.setupStatusSourceMissing.message",
      userActionKey: "error.dashboard.setupStatusSourceMissing.action",
      activeProject: null,
      activeProjectId: null,
    }), 500);
    return;
  }

  const activeProject = sources.projects.getActiveProject();
  sendJson(response, {
    ok: true,
    status: activeProject ? "ready" : "not_configured",
    activeProject: projectToSnapshot(activeProject),
    activeProjectId: activeProject?.id ?? null,
  });
}

export async function handleProjectCreatePost(
  request: IncomingMessage,
  response: ServerResponse,
  sources: DashboardRuntimeSources,
): Promise<void> {
  const locale = getDashboardResponseLocale(sources);
  if (!sources.projects) {
    sendJson(response, withMessageKeys(locale, {
      ok: false,
      status: "not_configured",
      messageKey: "error.dashboard.setupStatusSourceMissing.message",
      userActionKey: "error.dashboard.setupStatusSourceMissing.action",
    }), 500);
    return;
  }

  try {
    const body = await readJsonBody(request);
    const result = await sources.projects.createDraftProject(readCreateDraftInput(body));
    const statusCode = result.switchResult && !result.switchResult.ok
      ? result.switchResult.httpStatus
      : result.reused
        ? 200
        : 201;
    sendJson(response, {
      ok: !result.switchResult || result.switchResult.ok,
      status: result.switchResult && !result.switchResult.ok ? "blocked" : "done",
      project: projectToSnapshot(result.project),
      reused: result.reused,
      switchResult: switchResultToSnapshot(result.switchResult),
      activeProject: projectToSnapshot(sources.projects.getActiveProject()),
      activeProjectId: sources.projects.getActiveProject()?.id ?? null,
    }, statusCode);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    sendJson(response, redactForJson(withMessageKeys(locale, {
      ok: false,
      status: "failed",
      messageKey: "error.dashboard.requestInvalid.message",
      userActionKey: "error.dashboard.requestInvalid.action",
      detail,
    })), 400);
  }
}

export async function handleProjectSwitchPost(
  request: IncomingMessage,
  response: ServerResponse,
  sources: DashboardRuntimeSources,
): Promise<void> {
  const locale = getDashboardResponseLocale(sources);
  if (!sources.projects) {
    sendJson(response, withMessageKeys(locale, {
      ok: false,
      status: "not_configured",
      messageKey: "error.dashboard.setupStatusSourceMissing.message",
      userActionKey: "error.dashboard.setupStatusSourceMissing.action",
    }), 500);
    return;
  }

  try {
    const body = await readJsonBody(request);
    const projectId = readProjectId(body);
    if (!projectId) {
      sendJson(response, withMessageKeys(locale, {
        ok: false,
        status: "failed",
        messageKey: "error.dashboard.requestInvalid.message",
        userActionKey: "error.dashboard.requestInvalid.action",
      }), 400);
      return;
    }

    const result = await sources.projects.switchActiveProject(projectId);
    sendJson(response, {
      ...switchResultToSnapshot(result),
      activeProject: projectToSnapshot(sources.projects.getActiveProject()),
      activeProjectId: sources.projects.getActiveProject()?.id ?? null,
    }, result.ok ? 200 : result.httpStatus);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    sendJson(response, redactForJson(withMessageKeys(locale, {
      ok: false,
      status: "failed",
      messageKey: "error.dashboard.requestInvalid.message",
      userActionKey: "error.dashboard.requestInvalid.action",
      detail,
    })), 400);
  }
}

function readCreateDraftInput(body: unknown): DashboardProjectsCreateDraftInput {
  if (!isRecord(body)) {
    return {};
  }
  return {
    name: typeof body.name === "string" && body.name.trim()
      ? body.name.trim()
      : undefined,
    reuseEmptyDraft: typeof body.reuseEmptyDraft === "boolean"
      ? body.reuseEmptyDraft
      : undefined,
    activate: typeof body.activate === "boolean" ? body.activate : undefined,
  };
}

function readProjectId(body: unknown): string | null {
  if (!isRecord(body)) {
    return null;
  }
  const value = body.projectId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function switchResultToSnapshot(
  result: ActiveProjectSwitchResult | undefined,
):
  | (Omit<ActiveProjectSwitchResult, "activeProject"> & {
      activeProject?: DashboardProjectSnapshot;
    })
  | undefined {
  if (!result) {
    return undefined;
  }
  if (!result.ok) {
    return result;
  }
  return {
    ...result,
    activeProject: projectToSnapshot(result.activeProject) ?? undefined,
  };
}

function projectToSnapshot(
  project: DirongProjectRow | null,
): DashboardProjectSnapshot | null {
  if (!project) {
    return null;
  }
  return projectRowToSnapshot(project);
}

function projectRowToSnapshot(
  project: DirongProjectRow,
): DashboardProjectSnapshot {
  return {
    id: project.id,
    name: project.name,
    lifecycleStatus: project.lifecycle_status,
    guildId: project.guild_id,
    guildName: project.guild_name,
    guildIconUrl: project.guild_icon_url,
    commandEnabled: project.command_enabled === 1,
    notionConnectionConfigured: Boolean(project.notion_token_secret_ref),
    notionParentPageConfigured: Boolean(project.notion_parent_page_url),
    notionUploadMode: project.notion_upload_mode,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
    archivedAt: project.archived_at,
  };
}
