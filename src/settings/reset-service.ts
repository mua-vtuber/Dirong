import type { AiCleanupAutomationSnapshot } from "../ai/cleanup/automation-service.js";
import { t, type LocaleKey } from "../i18n/catalog.js";
import type { NotionAutomationSnapshot } from "../notion/automation-service.js";
import type { NotionDashboardService } from "../notion/dashboard-service.js";
import type { NotionMemberRosterStore } from "../notion/member-roster-store.js";
import type { NotionCustomPropertyRuleStore } from "../notion/property-rules.js";
import type { NotionRegistryStore } from "../notion/registry-store.js";
import type { NotionWriteStore } from "../notion/write-store.js";
import type { DirongProjectRow } from "../projects/project-types.js";
import type { ProjectStore } from "../projects/project-store.js";
import type { RecordingRuntimeState } from "../storage/rows.js";
import { summarizeSafeError } from "../errors.js";
import { DEFAULT_SECRET_REFS, type LocalSecretStore } from "./local-secret-store.js";
import {
  type DirongLocale,
  type DirongLocalSettings,
  type LocalSettingsStore,
  type SttLocalSettings,
} from "./local-settings-store.js";
import type {
  ProductSetupStatusSnapshot,
  SettingsRuntimeEffect,
  SettingsRuntimeEffectKind,
  SettingsRuntimeEffectScope,
} from "./product-settings.js";

export type SettingsResetMode = "full" | "current_project_connection";

export type SettingsResetBlockReason =
  | "recording_active"
  | "notion_upload_in_flight"
  | "ai_cleanup_in_flight"
  | "reset_already_running";

export type SettingsResetSqliteRows = {
  notionWorkspaceSettings: number;
  notionManagedDatabases: number;
  notionPropertyMappings: number;
  notionMemberRosterEntries: number;
  notionMemberRosterSyncs: number;
  notionCustomPropertyRules: number;
  notionWritesBlocked: number;
  repairItemsIgnored: number;
  projectsArchived: number;
  projectsFreshDraft: number;
};

export type SettingsResetDeletedSummary = {
  settingsKeys: string[];
  secretRefs: string[];
  sqliteRows: SettingsResetSqliteRows;
  blockedNotionWrites: number;
};

export type SettingsResetSuccessResult = {
  ok: true;
  status: "done";
  mode: SettingsResetMode;
  deleted: SettingsResetDeletedSummary;
  runtimeEffects: SettingsRuntimeEffect[];
  setup: ProductSetupStatusSnapshot;
  activeProject: DirongProjectRow | null;
  activeProjectId: string | null;
};

export type SettingsResetBlockedResult = {
  ok: false;
  status: "blocked";
  reason: SettingsResetBlockReason;
  httpStatus: 409;
  message: string;
  setup?: ProductSetupStatusSnapshot;
};

export type SettingsResetFailedResult = {
  ok: false;
  status: "failed";
  httpStatus: 500;
  message: string;
  detail: string;
  setup?: ProductSetupStatusSnapshot;
  activeProject: DirongProjectRow | null;
  activeProjectId: string | null;
  recovery: {
    activeProjectLifecycleRestored: boolean;
    notionAutomationRestarted: boolean;
  };
};

export type SettingsResetResult =
  | SettingsResetSuccessResult
  | SettingsResetBlockedResult
  | SettingsResetFailedResult;

export type SettingsResetRequest = {
  mode: SettingsResetMode;
  confirm: true;
};

export type SettingsResetServiceOptions = {
  settingsStore: LocalSettingsStore;
  secretStore: LocalSecretStore;
  projectStore: ProjectStore;
  registryStore: NotionRegistryStore;
  memberRosterStore: NotionMemberRosterStore;
  customPropertyRuleStore: NotionCustomPropertyRuleStore;
  writeStore: NotionWriteStore;
  setupStatus: { getSnapshot(): ProductSetupStatusSnapshot };
  getRecordingRuntimeState?: () => RecordingRuntimeState;
  getNotionAutomationSnapshot?: () => NotionAutomationSnapshot;
  getAiCleanupAutomationSnapshot?: () => AiCleanupAutomationSnapshot;
  stopNotionAutomation?: () => Promise<void>;
  startNotionAutomation?: () => void | Promise<void>;
  runNotionAutomationOnce?: () => Promise<NotionAutomationSnapshot>;
  stopAiCleanupAutomation?: () => Promise<void>;
  stopAiLifecycle?: () => Promise<void>;
  notionDashboard?: Pick<NotionDashboardService, "clearCachedManagedSchemaCheck">;
  now?: () => Date;
};

export class SettingsResetService {
  private running = false;

  constructor(private readonly options: SettingsResetServiceOptions) {}

  async reset(input: SettingsResetRequest): Promise<SettingsResetResult> {
    if (this.running) {
      return this.blocked("reset_already_running");
    }

    this.running = true;
    try {
      return await this.performReset(input.mode);
    } finally {
      this.running = false;
    }
  }

  private async performReset(
    mode: SettingsResetMode,
  ): Promise<SettingsResetResult> {
    const guarded = this.guardReset();
    if (guarded) {
      return guarded;
    }

    const nowIso = this.nowIso();
    const settingsBefore = this.options.settingsStore.read();
    const projectsBefore = this.options.projectStore.listProjects();
    const activeBefore = this.options.projectStore.getActiveProject();
    const activeProjectId = activeBefore?.id ?? null;
    let projectBoundaryCommitted = false;
    let notionAutomationStopped = false;
    let notionAutomationRestarted = false;

    try {
      if (activeProjectId) {
        this.options.projectStore.markProjectResetting(activeProjectId, nowIso);
      }

      await this.options.stopNotionAutomation?.();
      notionAutomationStopped = true;
      if (mode === "full") {
        await this.options.stopAiCleanupAutomation?.();
        await this.options.stopAiLifecycle?.();
      }

      const affectedProjectIds = mode === "full"
        ? projectsBefore.map((project) => project.id)
        : activeProjectId
          ? [activeProjectId]
          : [];
      const sqliteRows = this.clearSqliteProjectState(affectedProjectIds, mode, nowIso);
      const projectResult = mode === "full"
        ? this.options.projectStore.resetAllProjectConnectionsForFullReset(nowIso)
        : this.options.projectStore.resetCurrentProjectConnection({
            projectId: activeProjectId,
            nowIso,
            forceArchiveAndReplace: activeProjectId ? undefined : true,
          });
      projectBoundaryCommitted = true;
      this.options.notionDashboard?.clearCachedManagedSchemaCheck();

      const projectRows = mode === "full"
        ? projectsBefore.length
        : "archivedProjectId" in projectResult && projectResult.archivedProjectId
          ? 1
          : 0;
      sqliteRows.projectsArchived = projectRows;
      sqliteRows.projectsFreshDraft = 1;

      const secretRefs = mode === "full"
        ? collectFullResetSecretRefs(settingsBefore, projectsBefore)
        : collectCurrentProjectSecretRefs(activeBefore, settingsBefore);
      const deletedSecretRefs = deleteExistingSecrets(this.options.secretStore, secretRefs);
      const settingsKeys = mode === "full"
        ? fullResetSettingsKeys(settingsBefore)
        : currentProjectResetSettingsKeys(settingsBefore);

      this.options.settingsStore.update((settings) =>
        mode === "full"
          ? settingsAfterFullReset(settings)
          : settingsAfterCurrentProjectReset(settings),
      );
      notionAutomationRestarted = await this.restartNotionAutomationForNextTick();

      const setup = this.options.setupStatus.getSnapshot();
      return {
        ok: true,
        status: "done",
        mode,
        deleted: {
          settingsKeys,
          secretRefs: deletedSecretRefs,
          sqliteRows,
          blockedNotionWrites: sqliteRows.notionWritesBlocked,
        },
        runtimeEffects: resetRuntimeEffects(setup.locale, mode),
        setup,
        activeProject: this.options.projectStore.getActiveProject(),
        activeProjectId: this.options.projectStore.getActiveProjectId(),
      };
    } catch (error) {
      const activeProjectLifecycleRestored = projectBoundaryCommitted
        ? false
        : this.restoreActiveProjectLifecycle(activeBefore, nowIso);
      if (notionAutomationStopped && !notionAutomationRestarted) {
        notionAutomationRestarted = await this.tryRestartNotionAutomationForRecovery();
      }
      return this.failed(error, {
        activeProjectLifecycleRestored,
        notionAutomationRestarted,
      });
    }
  }

  private guardReset(): SettingsResetBlockedResult | null {
    const recording = this.options.getRecordingRuntimeState?.();
    if (recording?.isRecording) {
      return this.blocked("recording_active");
    }

    const notion = this.options.getNotionAutomationSnapshot?.();
    if ((notion?.inFlightDraftIds.length ?? 0) > 0) {
      return this.blocked("notion_upload_in_flight");
    }

    const aiCleanup = this.options.getAiCleanupAutomationSnapshot?.();
    if ((aiCleanup?.inFlightSessionIds.length ?? 0) > 0) {
      return this.blocked("ai_cleanup_in_flight");
    }

    return null;
  }

  private blocked(reason: SettingsResetBlockReason): SettingsResetBlockedResult {
    return {
      ok: false,
      status: "blocked",
      reason,
      httpStatus: 409,
      message: resetBlockMessage(reason),
      setup: safeSetupSnapshot(this.options.setupStatus),
    };
  }

  private clearSqliteProjectState(
    projectIds: readonly string[],
    mode: SettingsResetMode,
    nowIso: string,
  ): SettingsResetSqliteRows {
    const rows: SettingsResetSqliteRows = {
      notionWorkspaceSettings: 0,
      notionManagedDatabases: 0,
      notionPropertyMappings: 0,
      notionMemberRosterEntries: 0,
      notionMemberRosterSyncs: 0,
      notionCustomPropertyRules: 0,
      notionWritesBlocked: 0,
      repairItemsIgnored: 0,
      projectsArchived: 0,
      projectsFreshDraft: 0,
    };

    for (const projectId of projectIds) {
      const registry = this.options.registryStore.clearProject(projectId);
      rows.notionWorkspaceSettings += registry.workspaceSettings;
      rows.notionManagedDatabases += registry.managedDatabases;
      rows.notionPropertyMappings += registry.propertyMappings;

      const roster = this.options.memberRosterStore.clearProject(projectId);
      rows.notionMemberRosterEntries += roster.entries;
      rows.notionMemberRosterSyncs += roster.syncs;

      rows.notionCustomPropertyRules +=
        this.options.customPropertyRuleStore.clearProject(projectId);
      rows.notionWritesBlocked +=
        this.options.writeStore.blockNonTerminalWritesForReset({
          projectId,
          nowIso,
          message: `Blocked by ${mode} settings reset`,
        });
      rows.repairItemsIgnored +=
        this.options.projectStore.closeManagedSchemaRepairItemsForReset({
          projectIds: [projectId],
          nowIso,
        });
      this.options.projectStore.markUploadScopeResetBoundary({
        projectId,
        mode,
        nowIso,
      });
    }

    return rows;
  }

  private nowIso(): string {
    return (this.options.now ?? (() => new Date()))().toISOString();
  }

  private restoreActiveProjectLifecycle(
    activeBefore: DirongProjectRow | null,
    nowIso: string,
  ): boolean {
    if (!activeBefore) {
      return false;
    }
    if (this.options.projectStore.getActiveProjectId() !== activeBefore.id) {
      return false;
    }
    const current = this.options.projectStore.getProject(activeBefore.id);
    if (current?.lifecycle_status !== "resetting") {
      return false;
    }

    switch (activeBefore.lifecycle_status) {
      case "ready":
        this.options.projectStore.markProjectReady(activeBefore.id, nowIso);
        return true;
      case "draft":
        this.options.projectStore.markProjectDraft(activeBefore.id, nowIso);
        return true;
      case "archived":
      case "resetting":
        return false;
    }
  }

  private async restartNotionAutomationForNextTick(): Promise<boolean> {
    if (!this.options.startNotionAutomation && !this.options.runNotionAutomationOnce) {
      return false;
    }
    await this.options.startNotionAutomation?.();
    await this.options.runNotionAutomationOnce?.();
    return true;
  }

  private async tryRestartNotionAutomationForRecovery(): Promise<boolean> {
    try {
      return await this.restartNotionAutomationForNextTick();
    } catch {
      return false;
    }
  }

  private failed(
    error: unknown,
    recovery: SettingsResetFailedResult["recovery"],
  ): SettingsResetFailedResult {
    return {
      ok: false,
      status: "failed",
      httpStatus: 500,
      message: "Settings reset failed. Project state was recovered when possible.",
      detail: summarizeSafeError(error, 500),
      setup: safeSetupSnapshot(this.options.setupStatus),
      activeProject: safeActiveProject(this.options.projectStore),
      activeProjectId: safeActiveProjectId(this.options.projectStore),
      recovery,
    };
  }
}

function safeActiveProject(projectStore: ProjectStore): DirongProjectRow | null {
  try {
    return projectStore.getActiveProject();
  } catch {
    return null;
  }
}

function safeActiveProjectId(projectStore: ProjectStore): string | null {
  try {
    return projectStore.getActiveProjectId();
  } catch {
    return null;
  }
}

function resetBlockMessage(reason: SettingsResetBlockReason): string {
  switch (reason) {
    case "recording_active":
      return "Cannot reset settings while recording is active.";
    case "notion_upload_in_flight":
      return "Cannot reset settings while a Notion upload is in flight.";
    case "ai_cleanup_in_flight":
      return "Cannot reset settings while AI cleanup is in flight.";
    case "reset_already_running":
      return "Another settings reset is already running.";
  }
}

function safeSetupSnapshot(
  source: { getSnapshot(): ProductSetupStatusSnapshot },
): ProductSetupStatusSnapshot | undefined {
  try {
    return source.getSnapshot();
  } catch {
    return undefined;
  }
}

function collectFullResetSecretRefs(
  settings: DirongLocalSettings,
  projects: readonly DirongProjectRow[],
): string[] {
  return uniqueStrings([
    settings.discord.botTokenSecretRef ?? DEFAULT_SECRET_REFS.discordBotToken,
    settings.stt.openAiApiKeySecretRef ?? DEFAULT_SECRET_REFS.openAiApiKey,
    settings.ai.apiKeySecretRef ?? DEFAULT_SECRET_REFS.claudeApiKey,
    settings.notion.tokenSecretRef ?? DEFAULT_SECRET_REFS.notionToken,
    ...projects.map((project) => project.notion_token_secret_ref),
  ]);
}

function collectCurrentProjectSecretRefs(
  activeProject: DirongProjectRow | null,
  settings: DirongLocalSettings,
): string[] {
  return uniqueStrings([
    activeProject?.notion_token_secret_ref ?? null,
    settings.notion.tokenSecretRef ?? null,
  ]);
}

function deleteExistingSecrets(
  secretStore: LocalSecretStore,
  refs: readonly string[],
): string[] {
  const existing = new Set(secretStore.listRefs());
  const deleted: string[] = [];
  for (const ref of refs) {
    if (!existing.has(ref)) {
      continue;
    }
    secretStore.delete(ref);
    deleted.push(ref);
  }
  return deleted;
}

function fullResetSettingsKeys(settings: DirongLocalSettings): string[] {
  return [
    settings.discord.applicationId ? "discord.applicationId" : null,
    settings.discord.botTokenSecretRef ? "discord.botTokenSecretRef" : null,
    (settings.discord.guildIds?.length ?? 0) > 0 ? "discord.guildIds" : null,
    settings.stt.provider === "openai" ? "stt.provider" : null,
    settings.stt.openAiApiKeySecretRef ? "stt.openAiApiKeySecretRef" : null,
    settings.stt.openAiModel ? "stt.openAiModel" : null,
    settings.ai.provider ? "ai.provider" : null,
    settings.ai.mode ? "ai.mode" : null,
    settings.ai.model ? "ai.model" : null,
    settings.ai.cliProfile ? "ai.cliProfile" : null,
    settings.ai.cliCommand ? "ai.cliCommand" : null,
    settings.ai.claudeProfile ? "ai.claudeProfile" : null,
    settings.ai.claudeCommand ? "ai.claudeCommand" : null,
    settings.ai.apiKeySecretRef ? "ai.apiKeySecretRef" : null,
    settings.notion.tokenSecretRef ? "notion.tokenSecretRef" : null,
    settings.notion.parentPageUrl ? "notion.parentPageUrl" : null,
    settings.notion.uploadMode ? "notion.uploadMode" : null,
  ].filter((key): key is string => key !== null);
}

function currentProjectResetSettingsKeys(settings: DirongLocalSettings): string[] {
  return [
    (settings.discord.guildIds?.length ?? 0) > 0 ? "discord.guildIds" : null,
    settings.notion.tokenSecretRef ? "notion.tokenSecretRef" : null,
    settings.notion.parentPageUrl ? "notion.parentPageUrl" : null,
    settings.notion.uploadMode ? "notion.uploadMode" : null,
  ].filter((key): key is string => key !== null);
}

function settingsAfterFullReset(settings: DirongLocalSettings): DirongLocalSettings {
  return {
    ...settings,
    discord: {},
    stt: preserveWhisperSettings(settings.stt),
    ai: {},
    notion: {},
  };
}

function settingsAfterCurrentProjectReset(
  settings: DirongLocalSettings,
): DirongLocalSettings {
  return {
    ...settings,
    discord: {
      applicationId: settings.discord.applicationId,
      botTokenSecretRef: settings.discord.botTokenSecretRef,
    },
    notion: {},
  };
}

function preserveWhisperSettings(settings: SttLocalSettings): SttLocalSettings {
  return {
    provider: "local-whisper",
    language: settings.language,
    timeoutMs: settings.timeoutMs,
    localWhisper: settings.localWhisper,
  };
}

function resetRuntimeEffects(
  locale: DirongLocale,
  mode: SettingsResetMode,
): SettingsRuntimeEffect[] {
  const effects: SettingsRuntimeEffect[] = [
    makeRuntimeEffect(locale, "discord", "current_process", {
      messageKey: "dashboard.settings.reset.effects.discord.message",
      userActionKey: "dashboard.settings.reset.effects.discord.action",
    }),
    makeRuntimeEffect(locale, "notion", "next_tick", {
      messageKey: "dashboard.settings.reset.effects.notion.message",
      userActionKey: null,
    }),
  ];

  if (mode === "full") {
    effects.push(
      makeRuntimeEffect(locale, "ai", "restart_required", {
        messageKey: "dashboard.settings.reset.effects.ai.message",
        userActionKey: "dashboard.settings.reset.effects.ai.action",
      }),
    );
  }

  return effects;
}

function makeRuntimeEffect(
  locale: DirongLocale,
  scope: SettingsRuntimeEffectScope,
  kind: SettingsRuntimeEffectKind,
  keys: { messageKey: LocaleKey; userActionKey: LocaleKey | null },
): SettingsRuntimeEffect {
  return {
    scope,
    kind,
    messageKey: keys.messageKey,
    message: t(locale, keys.messageKey),
    userActionKey: keys.userActionKey,
    userAction: keys.userActionKey ? t(locale, keys.userActionKey) : null,
  };
}

function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const cleaned = value?.trim();
    if (!cleaned || seen.has(cleaned)) {
      continue;
    }
    seen.add(cleaned);
    result.push(cleaned);
  }
  return result;
}
