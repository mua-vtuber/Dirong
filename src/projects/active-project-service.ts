import type { AiCleanupAutomationSnapshot } from "../ai/cleanup/automation-service.js";
import type { NotionAutomationSnapshot } from "../notion/automation-service.js";
import type { RecordingRuntimeState } from "../storage/rows.js";
import type { DirongProjectRow } from "./project-types.js";
import { ProjectStore } from "./project-store.js";

export type ActiveProjectSwitchBlockReason =
  | "already_switching"
  | "project_not_found"
  | "project_archived"
  | "project_resetting"
  | "recording_active"
  | "notion_upload_in_flight"
  | "ai_cleanup_in_flight";

export type ActiveProjectSwitchResult =
  | {
      ok: true;
      status: "done";
      activeProject: DirongProjectRow;
    }
  | {
      ok: false;
      status: "blocked";
      reason: ActiveProjectSwitchBlockReason;
      httpStatus: 404 | 409;
      message: string;
    };

export type ActiveProjectServiceOptions = {
  projectStore: ProjectStore;
  getRecordingRuntimeState?: () => RecordingRuntimeState;
  getNotionAutomationSnapshot?: () => NotionAutomationSnapshot;
  getAiCleanupAutomationSnapshot?: () => AiCleanupAutomationSnapshot;
  onBeforeActivate?: (project: DirongProjectRow) => void | Promise<void>;
  onAfterActivate?: (project: DirongProjectRow) => void | Promise<void>;
  now?: () => Date;
};

export class ActiveProjectService {
  private switchingPromise: Promise<ActiveProjectSwitchResult> | null = null;

  constructor(private readonly options: ActiveProjectServiceOptions) {}

  getActiveProject(): DirongProjectRow | null {
    return this.options.projectStore.getActiveProject();
  }

  getActiveProjectId(): string | null {
    return this.options.projectStore.getActiveProjectId();
  }

  async switchActiveProject(projectId: string): Promise<ActiveProjectSwitchResult> {
    if (this.switchingPromise) {
      return blocked(
        "already_switching",
        "Another active project switch is already running.",
      );
    }

    this.switchingPromise = this.performSwitch(projectId).finally(() => {
      this.switchingPromise = null;
    });
    return await this.switchingPromise;
  }

  private async performSwitch(projectId: string): Promise<ActiveProjectSwitchResult> {
    const target = this.options.projectStore.getProject(projectId);
    if (!target) {
      return blocked("project_not_found", `Project not found: ${projectId}`, 404);
    }

    const guard = this.guardSwitch(target);
    if (guard) {
      return guard;
    }

    this.options.projectStore.setProjectSwitching(true, this.nowIso());
    try {
      await this.options.onBeforeActivate?.(target);
      this.options.projectStore.setActiveProjectId(target.id, this.nowIso());
      const activeProject = this.options.projectStore.getProject(target.id);
      if (!activeProject) {
        throw new Error(`Project not found after switch: ${target.id}`);
      }
      await this.options.onAfterActivate?.(activeProject);
      return {
        ok: true,
        status: "done",
        activeProject,
      };
    } finally {
      if (this.options.projectStore.getProjectState()?.switching === 1) {
        this.options.projectStore.setProjectSwitching(false, this.nowIso());
      }
    }
  }

  private guardSwitch(
    target: DirongProjectRow,
  ): Extract<ActiveProjectSwitchResult, { ok: false }> | null {
    const state = this.options.projectStore.getProjectState();
    if (state?.switching === 1) {
      return blocked(
        "already_switching",
        "Another active project switch is already running.",
      );
    }

    if (target.lifecycle_status === "archived") {
      return blocked(
        "project_archived",
        "Archived projects cannot become active.",
      );
    }

    if (target.lifecycle_status === "resetting") {
      return blocked(
        "project_resetting",
        "Projects currently resetting cannot become active.",
      );
    }

    const recording = this.options.getRecordingRuntimeState?.();
    if (recording?.isRecording) {
      return blocked(
        "recording_active",
        "Cannot switch active project while recording is active.",
      );
    }

    const notion = this.options.getNotionAutomationSnapshot?.();
    if ((notion?.inFlightDraftIds.length ?? 0) > 0) {
      return blocked(
        "notion_upload_in_flight",
        "Cannot switch active project while Notion upload is in flight.",
      );
    }

    const aiCleanup = this.options.getAiCleanupAutomationSnapshot?.();
    if ((aiCleanup?.inFlightSessionIds.length ?? 0) > 0) {
      return blocked(
        "ai_cleanup_in_flight",
        "Cannot switch active project while AI cleanup is in flight.",
      );
    }

    return null;
  }

  private nowIso(): string {
    return (this.options.now ?? (() => new Date()))().toISOString();
  }
}

function blocked(
  reason: ActiveProjectSwitchBlockReason,
  message: string,
  httpStatus: 404 | 409 = 409,
): Extract<ActiveProjectSwitchResult, { ok: false }> {
  return {
    ok: false,
    status: "blocked",
    reason,
    httpStatus,
    message,
  };
}
