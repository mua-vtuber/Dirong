import type { DirongProjectRow } from "../projects/project-types.js";

export type ActiveProjectCommandGateResult =
  | {
      ok: true;
      projectId: string | null;
    }
  | {
      ok: false;
      reason:
        | "legacy_guild_not_allowed"
        | "project_data_without_active_project"
        | "active_project_unavailable"
        | "active_project_command_disabled"
        | "active_project_guild_not_configured"
        | "active_project_guild_mismatch";
      activeProjectId: string | null;
    };

export type ActiveProjectCommandGateInput = {
  guildId: string;
  legacyGuildIds: readonly string[];
  activeProject: DirongProjectRow | null;
  hasProjectData: boolean;
};

export function evaluateActiveProjectCommandGate(
  input: ActiveProjectCommandGateInput,
): ActiveProjectCommandGateResult {
  if (input.activeProject) {
    const activeProject = input.activeProject;
    if (
      activeProject.archived_at ||
      activeProject.lifecycle_status === "archived" ||
      activeProject.lifecycle_status === "resetting"
    ) {
      return blocked("active_project_unavailable", activeProject.id);
    }
    if (activeProject.command_enabled !== 1) {
      return blocked("active_project_command_disabled", activeProject.id);
    }
    if (!activeProject.guild_id) {
      return blocked("active_project_guild_not_configured", activeProject.id);
    }
    if (activeProject.guild_id !== input.guildId) {
      return blocked("active_project_guild_mismatch", activeProject.id);
    }
    return { ok: true, projectId: activeProject.id };
  }

  if (input.hasProjectData) {
    return blocked("project_data_without_active_project", null);
  }

  if (!input.legacyGuildIds.includes(input.guildId)) {
    return blocked("legacy_guild_not_allowed", null);
  }
  return { ok: true, projectId: null };
}

function blocked(
  reason: Extract<ActiveProjectCommandGateResult, { ok: false }>["reason"],
  activeProjectId: string | null,
): Extract<ActiveProjectCommandGateResult, { ok: false }> {
  return {
    ok: false,
    reason,
    activeProjectId,
  };
}
