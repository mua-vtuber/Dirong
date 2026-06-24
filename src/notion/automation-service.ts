import { redactSensitiveText, summarizeSafeError } from "../errors.js";
import {
  buildHumanStatusDisplay,
  formatHumanStatusDisplayForText,
  type HumanStatusDisplay,
  type HumanStatusDisplayInput,
} from "../messages/human-status.js";
import {
  resolveAppLocale,
  type AppLocaleResolver,
} from "../i18n/app-locale.js";
import { formatLocaleText, t, type LocaleKey } from "../i18n/catalog.js";
import { PollingLoop } from "../runtime/polling-loop.js";
import type { DirongLocale } from "../settings/local-settings-store.js";
import { DEFAULT_PROJECT_ID } from "../projects/project-types.js";
import {
  NotionApiError,
  type NotionClient,
} from "./client.js";
import type { NotionCustomPropertyRule } from "./property-rules.js";
import type { NotionMemberRosterStore } from "./member-roster-store.js";
import type { NotionRegistryStore } from "./registry-store.js";
import type {
  NotionDraftCandidateRow,
  NotionDraftInputReadModel,
} from "./draft-input-read-model.js";
import type {
  NotionRuntimeSettings,
  NotionRuntimeSettingsProvider,
} from "./settings.js";
import { parseNotionTargetUrl } from "./target.js";
import {
  runNotionUpload,
  type NotionUploadResult,
  type NotionUploadStatus,
} from "./writer.js";
import {
  blockPartialManagedNotionRegistry,
  hasCompleteManagedNotionUploadRegistry,
} from "./managed-registry-policy.js";
import { readDataSources, readId } from "./data-source-readers.js";
import type { NotionWriteStore } from "./write-store.js";
import {
  applyRetentionAfterSuccessfulUpload,
  type NotionUploadRetentionHandler,
} from "./upload-retention.js";

export type NotionAutomationStatus =
  | "disabled"
  | "manual"
  | "not_configured"
  | "idle"
  | "running"
  | "done"
  | "not_claimed"
  | "retry_wait"
  | "blocked"
  | "failed"
  | "stopped";

export type NotionAutomationSnapshot = {
  enabled: boolean;
  configured: boolean;
  uploadMode: string;
  status: NotionAutomationStatus;
  checkedAt: string | null;
  sessionId: string | null;
  draftId: string | null;
  targetId: string | null;
  writeId: string | null;
  pageUrl: string | null;
  message: string;
  userAction: string | null;
  technicalDetail: string | null;
  display?: HumanStatusDisplay;
  lastRunStatus: NotionUploadStatus | null;
  inFlightDraftIds: string[];
  repairedExpiredLeases: number;
};

export type NotionAutomationServiceOptions = {
  settings: NotionRuntimeSettings;
  getSettings?: NotionRuntimeSettingsProvider;
  client?: NotionClient | null;
  getClient?: (settings: NotionRuntimeSettings) => NotionClient | null;
  readModel: NotionDraftInputReadModel;
  writeStore: NotionWriteStore;
  pollIntervalMs: number;
  batchLimit: number;
  workerId: string;
  leaseMs: number;
  projectId?: string | null;
  getProjectId?: () => string | null;
  getAutomaticUploadAfter?: (projectId: string) => string | null;
  registryStore?: NotionRegistryStore | null;
  memberRosterStore?: NotionMemberRosterStore | null;
  customPropertyRules?: () => readonly NotionCustomPropertyRule[];
  retention?: NotionUploadRetentionHandler;
  localeResolver?: AppLocaleResolver;
};

type NotionAutomationRuntime = {
  settings: NotionRuntimeSettings;
  client: NotionClient | null;
};

export class NotionAutomationService {
  private readonly loop: PollingLoop<NotionAutomationSnapshot>;
  private readonly inFlightDraftIds = new Set<string>();
  private snapshot: NotionAutomationSnapshot;

  constructor(private readonly options: NotionAutomationServiceOptions) {
    const runtime = this.getRuntime();
    const projectId = this.resolveProjectId();
    const locale = this.resolveLocale();
    this.snapshot = this.makeSnapshot({
      enabled: runtime.settings.enabled,
      configured: isConfigured(runtime, options.registryStore ?? null, projectId),
      uploadMode: runtime.settings.uploadMode,
      status: initialStatus(runtime, options.registryStore ?? null, projectId),
      checkedAt: null,
      sessionId: null,
      draftId: null,
      targetId: null,
      writeId: null,
      pageUrl: null,
      message: initialMessage(runtime, options.registryStore ?? null, projectId, locale),
      userAction: initialUserAction(
        runtime,
        options.registryStore ?? null,
        projectId,
        locale,
      ),
      technicalDetail: null,
      lastRunStatus: null,
      inFlightDraftIds: [],
      repairedExpiredLeases: 0,
    });
    this.loop = new PollingLoop({
      intervalMs: options.pollIntervalMs,
      runTick: (signal) => this.tick(signal),
      onScheduledError: (error) => {
        this.snapshot = this.makeSnapshot({
          ...this.snapshot,
          status: "failed",
          checkedAt: new Date().toISOString(),
          message: this.messageForStatus("failed"),
          userAction: this.userActionForStatus("failed"),
          technicalDetail: summarizeSafeError(error),
        });
      },
    });
  }

  start(): void {
    if (this.snapshot.status === "stopped") {
      const runtime = this.getRuntime();
      const projectId = this.resolveProjectId();
      const locale = this.resolveLocale();
      this.snapshot = this.makeSnapshot({
        ...clearRunSpecificFields(this.snapshot),
        enabled: runtime.settings.enabled,
        configured: isConfigured(runtime, this.options.registryStore ?? null, projectId),
        uploadMode: runtime.settings.uploadMode,
        status: initialStatus(runtime, this.options.registryStore ?? null, projectId),
        checkedAt: new Date().toISOString(),
        message: initialMessage(
          runtime,
          this.options.registryStore ?? null,
          projectId,
          locale,
        ),
        userAction: initialUserAction(
          runtime,
          this.options.registryStore ?? null,
          projectId,
          locale,
        ),
        technicalDetail: null,
        inFlightDraftIds: this.getInFlightDraftIds(),
      });
    }
    this.loop.start();
  }

  async stop(): Promise<void> {
    await this.loop.stop();
    this.snapshot = this.makeSnapshot({
      ...this.snapshot,
      status: "stopped",
      checkedAt: new Date().toISOString(),
      message: this.messageForStatus("stopped"),
      userAction: null,
      inFlightDraftIds: this.getInFlightDraftIds(),
    });
  }

  getSnapshot(locale?: DirongLocale): NotionAutomationSnapshot {
    return cloneSnapshot(
      localizeNotionAutomationSnapshot(
        this.snapshot,
        resolveAppLocale({ locale, getLocale: this.options.localeResolver }),
      ),
    );
  }

  async runOnce(): Promise<NotionAutomationSnapshot> {
    const blocked = blockedSnapshot(
      this.getRuntime(),
      this.options.registryStore ?? null,
      this.snapshot,
      this.resolveLocale(),
      this.resolveProjectId(),
    );
    if (blocked) {
      this.snapshot = blocked;
      return this.getSnapshot();
    }

    return await this.loop.runOnce();
  }

  private async tick(signal: AbortSignal): Promise<NotionAutomationSnapshot> {
    const runtime = this.getRuntime();
    const checkedAt = new Date().toISOString();
    const projectId = this.resolveProjectId();
    const repairedExpiredLeases =
      this.options.writeStore.releaseExpiredLeases(checkedAt);

    if (this.inFlightDraftIds.size > 0) {
      this.snapshot = this.makeSnapshot({
        ...this.snapshot,
        status: "running",
        checkedAt,
        message: this.messageForStatus("running"),
        userAction: null,
        repairedExpiredLeases,
        inFlightDraftIds: this.getInFlightDraftIds(),
      });
      return this.getSnapshot();
    }

    const blocked = blockedSnapshot(
      runtime,
      this.options.registryStore ?? null,
      this.snapshot,
      this.resolveLocale(),
      projectId,
    );
    if (blocked) {
      this.snapshot = this.makeSnapshot({
        ...blocked,
        repairedExpiredLeases,
        inFlightDraftIds: this.getInFlightDraftIds(),
      });
      return this.getSnapshot();
    }

    const target = await resolveAutomationTargetId(
      runtime.settings,
      runtime.client,
      this.options.registryStore ?? null,
      projectId,
      this.resolveLocale(),
    );
    if (!target.ok) {
      this.snapshot = this.makeSnapshot({
        ...clearRunSpecificFields(this.snapshot),
        status: target.status,
        checkedAt,
        message: target.message,
        userAction: target.userAction,
        technicalDetail: target.technicalDetail,
        repairedExpiredLeases,
        inFlightDraftIds: this.getInFlightDraftIds(),
      });
      return this.getSnapshot();
    }

    const automaticUploadAfter =
      this.options.getAutomaticUploadAfter?.(projectId) ?? null;
    const candidates =
      this.options.readModel.listLatestValidDraftsMissingDoneWrite({
        projectId,
        targetId: target.targetId,
        limit: this.options.batchLimit,
        createdAtOrAfter: automaticUploadAfter,
      });
    const candidate = candidates.find(
      (item) => !this.inFlightDraftIds.has(item.id),
    );
    if (!candidate) {
      this.snapshot = this.makeSnapshot({
        ...this.snapshot,
        status: "idle",
        checkedAt,
        sessionId: null,
        draftId: null,
        targetId: target.targetId,
        writeId: null,
        pageUrl: null,
        message: this.messageForStatus("idle"),
        userAction: null,
        technicalDetail: null,
        lastRunStatus: null,
        repairedExpiredLeases,
        inFlightDraftIds: this.getInFlightDraftIds(),
      });
      return this.getSnapshot();
    }

    return await this.runForDraft(
      candidate,
      target.targetId,
      repairedExpiredLeases,
      runtime,
      signal,
    );
  }

  private async runForDraft(
    candidate: NotionDraftCandidateRow,
    targetId: string,
    repairedExpiredLeases: number,
    runtime: NotionAutomationRuntime,
    signal: AbortSignal,
  ): Promise<NotionAutomationSnapshot> {
    this.inFlightDraftIds.add(candidate.id);
    this.snapshot = this.makeSnapshot({
      ...this.snapshot,
      status: "running",
      checkedAt: new Date().toISOString(),
      sessionId: candidate.session_id,
      draftId: candidate.id,
      targetId,
      message: this.messageForStatus("running"),
      userAction: null,
      technicalDetail: null,
      repairedExpiredLeases,
      inFlightDraftIds: this.getInFlightDraftIds(),
    });

    try {
      const result = await runNotionUpload({
        settings: runtime.settings,
        selector: { kind: "draft", draftId: candidate.id },
        dryRun: false,
        force: false,
        workerId: this.options.workerId,
        leaseMs: runtime.settings.leaseMs || this.options.leaseMs,
        client: runtime.client,
        readModel: this.options.readModel,
        writeStore: this.options.writeStore,
        registryStore: this.options.registryStore ?? null,
        projectId: this.resolveProjectId(),
        memberRosterStore: this.options.memberRosterStore ?? null,
        customPropertyRules: this.options.customPropertyRules?.() ?? [],
        signal,
        locale: this.resolveLocale(),
      });
      await applyRetentionAfterSuccessfulUpload(
        this.options.retention,
        result,
      );
      this.snapshot = snapshotFromRunResult({
        previous: this.snapshot,
        result,
        repairedExpiredLeases,
        locale: this.resolveLocale(),
      });
    } catch (error) {
      this.snapshot = this.makeSnapshot({
        ...this.snapshot,
        status: "failed",
        checkedAt: new Date().toISOString(),
        message: this.messageForStatus("failed"),
        userAction: this.userActionForStatus("failed"),
        technicalDetail: summarizeSafeError(error),
        repairedExpiredLeases,
      });
    } finally {
      this.inFlightDraftIds.delete(candidate.id);
      this.snapshot = this.makeSnapshot({
        ...this.snapshot,
        inFlightDraftIds: this.getInFlightDraftIds(),
      });
    }

    return this.getSnapshot();
  }

  private getInFlightDraftIds(): string[] {
    return [...this.inFlightDraftIds].sort();
  }

  private getRuntime(): NotionAutomationRuntime {
    const settings = this.options.getSettings?.() ?? this.options.settings;
    const client = this.options.getClient
      ? this.options.getClient(settings)
      : this.options.client ?? null;
    return { settings, client };
  }

  private makeSnapshot(
    snapshot: NotionAutomationSnapshot,
  ): NotionAutomationSnapshot {
    return makeSnapshot(snapshot, this.resolveLocale());
  }

  private messageForStatus(status: NotionAutomationStatus): string {
    return t(this.resolveLocale(), notionAutomationMessageKey(status));
  }

  private userActionForStatus(status: NotionAutomationStatus): string | null {
    const key = notionAutomationUserActionKey(status);
    return key ? t(this.resolveLocale(), key) : null;
  }

  private resolveLocale(): DirongLocale {
    return resolveAppLocale({ getLocale: this.options.localeResolver });
  }

  private resolveProjectId(): string {
    const projectId =
      this.options.getProjectId?.() ?? this.options.projectId ?? DEFAULT_PROJECT_ID;
    return cleanRequiredString(projectId, "projectId");
  }
}

export function formatNotionAutomationForStatus(
  snapshot: NotionAutomationSnapshot,
  locale?: DirongLocale,
): string {
  const resolvedLocale = resolveAppLocale({ locale });
  const localized = localizeNotionAutomationSnapshot(snapshot, resolvedLocale);
  const display = localized.display ?? buildNotionAutomationDisplay(resolvedLocale, localized);
  const lines = [
    formatHumanStatusDisplayForText(display, {
      title: t(resolvedLocale, "runtimeStatus.notionAutomation.statusText.title"),
      description: t(
        resolvedLocale,
        "runtimeStatus.notionAutomation.statusText.description",
      ),
      nextAction: t(
        resolvedLocale,
        "runtimeStatus.notionAutomation.statusText.nextAction",
      ),
    }),
    `Notion mode: ${snapshot.uploadMode}`,
  ];
  if (snapshot.draftId) {
    lines.push(`Notion draft: ${snapshot.draftId}`);
  }
  if (snapshot.pageUrl) {
    lines.push(`Notion page: ${snapshot.pageUrl}`);
  }
  if (snapshot.repairedExpiredLeases > 0) {
    lines.push(formatLocaleText(
      resolvedLocale,
      "runtimeStatus.notionAutomation.statusText.leaseRepair",
      { count: snapshot.repairedExpiredLeases },
    ));
  }
  return lines.join("\n");
}

function snapshotFromRunResult(input: {
  previous: NotionAutomationSnapshot;
  result: NotionUploadResult;
  repairedExpiredLeases: number;
  locale: DirongLocale;
}): NotionAutomationSnapshot {
  return makeSnapshot({
    ...input.previous,
    status: uploadStatusToAutomationStatus(input.result.status),
    checkedAt: new Date().toISOString(),
    sessionId: input.result.sessionId,
    draftId: input.result.draftId,
    targetId: input.result.targetId,
    writeId: input.result.writeId,
    pageUrl: input.result.pageUrl,
    message: input.result.message,
    userAction: input.result.userAction,
    technicalDetail: input.result.technicalDetail,
    lastRunStatus: input.result.status,
    repairedExpiredLeases: input.repairedExpiredLeases,
  }, input.locale);
}

async function resolveAutomationTargetId(
  settings: NotionRuntimeSettings,
  client: NotionClient | null,
  registryStore: NotionRegistryStore | null,
  projectId: string,
  locale: DirongLocale,
): Promise<
  | { ok: true; targetId: string }
  | {
      ok: false;
      status: Extract<
        NotionAutomationStatus,
        "not_configured" | "blocked" | "retry_wait"
      >;
      message: string;
      userAction: string;
      technicalDetail: string | null;
    }
> {
  const registryBlock = blockPartialManagedNotionRegistry(registryStore, {
    projectId,
  });
  if (registryBlock) {
    return {
      ok: false,
      status: "blocked",
      message: registryBlock.message,
      userAction: registryBlock.userAction,
      technicalDetail: registryBlock.technicalDetail,
    };
  }

  const managedMeeting = hasCompleteManagedNotionUploadRegistry(registryStore, {
    projectId,
  })
    ? registryStore?.getManagedDatabase("meeting", projectId)
    : null;
  if (managedMeeting) {
    return { ok: true, targetId: managedMeeting.dataSourceId };
  }

  if (!settings.targetUrl) {
    return {
      ok: false,
      status: "not_configured",
      message: "Notion target URL is missing.",
      userAction: t(locale, "runtimeStatus.notionAutomation.target.missingAction"),
      technicalDetail: null,
    };
  }

  const parsed = parseNotionTargetUrl(settings.targetUrl);
  if (parsed.kind === "invalid") {
    return {
      ok: false,
      status: "not_configured",
      message: "Notion target URL is invalid.",
      userAction: t(locale, "runtimeStatus.notionAutomation.target.invalidAction"),
      technicalDetail: parsed.reason,
    };
  }
  if (parsed.kind === "data_source_id") {
    return { ok: true, targetId: parsed.id };
  }

  if (!client) {
    return {
      ok: false,
      status: "not_configured",
      message: "Notion client is not available.",
      userAction: t(locale, "runtimeStatus.notionAutomation.target.clientMissingAction"),
      technicalDetail: null,
    };
  }

  try {
    const database = await client.retrieveDatabase(parsed.id);
    const dataSources = readDataSources(database);
    if (dataSources.length !== 1) {
      return {
        ok: false,
        status: "blocked",
        message: "Notion database must contain exactly one child data source.",
        userAction: t(
          locale,
          "runtimeStatus.notionAutomation.target.multipleDataSourcesAction",
        ),
        technicalDetail: `child data source count: ${dataSources.length}`,
      };
    }
    const targetId = readId(dataSources[0]);
    if (!targetId) {
      return {
        ok: false,
        status: "blocked",
        message: "Notion data source id is missing.",
        userAction: t(
          locale,
          "runtimeStatus.notionAutomation.target.dataSourceMissingAction",
        ),
        technicalDetail: "database child data source id missing",
      };
    }
    return { ok: true, targetId };
  } catch (error) {
    if (error instanceof NotionApiError) {
      return {
        ok: false,
        status: error.retriable ? "retry_wait" : "blocked",
        message: error.message,
        userAction: error.userAction,
        technicalDetail: error.technicalDetail,
      };
    }
    throw error;
  }
}

function uploadStatusToAutomationStatus(
  status: NotionUploadStatus,
): NotionAutomationStatus {
  if (status === "dry_run" || status === "draft_not_found") {
    return "idle";
  }
  if (status === "disabled" || status === "not_configured") {
    return status;
  }
  return status;
}

function clearRunSpecificFields(
  snapshot: NotionAutomationSnapshot,
): NotionAutomationSnapshot {
  return {
    ...snapshot,
    sessionId: null,
    draftId: null,
    targetId: null,
    writeId: null,
    pageUrl: null,
    lastRunStatus: null,
  };
}

function blockedSnapshot(
  runtime: NotionAutomationRuntime,
  registryStore: NotionRegistryStore | null,
  previous: NotionAutomationSnapshot,
  locale: DirongLocale,
  projectId: string,
): NotionAutomationSnapshot | null {
  const checkedAt = new Date().toISOString();
  if (!runtime.settings.enabled) {
    return makeSnapshot({
      ...clearRunSpecificFields(previous),
      enabled: false,
      configured: isConfigured(runtime, registryStore, projectId),
      uploadMode: runtime.settings.uploadMode,
      status: "disabled",
      checkedAt,
      message: t(locale, "runtimeStatus.notionAutomation.disabled.message"),
      userAction: t(locale, "runtimeStatus.notionAutomation.disabled.action"),
      technicalDetail: null,
    }, locale);
  }
  if (runtime.settings.uploadMode !== "automatic_after_ai_cleanup") {
    return makeSnapshot({
      ...clearRunSpecificFields(previous),
      enabled: true,
      configured: isConfigured(runtime, registryStore, projectId),
      uploadMode: runtime.settings.uploadMode,
      status: "manual",
      checkedAt,
      message: t(locale, "runtimeStatus.notionAutomation.manual.message"),
      userAction: t(locale, "runtimeStatus.notionAutomation.manual.action"),
      technicalDetail: null,
    }, locale);
  }
  if (!isConfigured(runtime, registryStore, projectId)) {
    return makeSnapshot({
      ...clearRunSpecificFields(previous),
      enabled: true,
      configured: false,
      uploadMode: runtime.settings.uploadMode,
      status: "not_configured",
      checkedAt,
      message: t(locale, "runtimeStatus.notionAutomation.notConfigured.message"),
      userAction: t(
        locale,
        "runtimeStatus.notionAutomation.notConfigured.action",
      ),
      technicalDetail: null,
    }, locale);
  }
  return null;
}

function isConfigured(
  runtime: NotionAutomationRuntime,
  registryStore: NotionRegistryStore | null,
  projectId: string,
): boolean {
  return Boolean(
    runtime.settings.apiKey &&
      (runtime.settings.targetUrl ||
        hasCompleteManagedNotionUploadRegistry(registryStore, { projectId })) &&
      runtime.client,
  );
}

function initialStatus(
  runtime: NotionAutomationRuntime,
  registryStore: NotionRegistryStore | null,
  projectId: string,
): NotionAutomationStatus {
  if (!runtime.settings.enabled) {
    return "disabled";
  }
  if (runtime.settings.uploadMode !== "automatic_after_ai_cleanup") {
    return "manual";
  }
  if (!isConfigured(runtime, registryStore, projectId)) {
    return "not_configured";
  }
  return "idle";
}

function initialMessage(
  runtime: NotionAutomationRuntime,
  registryStore: NotionRegistryStore | null,
  projectId: string,
  locale: DirongLocale,
): string {
  if (!runtime.settings.enabled) {
    return t(locale, "runtimeStatus.notionAutomation.disabled.message");
  }
  if (runtime.settings.uploadMode !== "automatic_after_ai_cleanup") {
    return t(locale, "runtimeStatus.notionAutomation.manual.message");
  }
  if (!isConfigured(runtime, registryStore, projectId)) {
    return t(locale, "runtimeStatus.notionAutomation.notConfigured.message");
  }
  return t(locale, "runtimeStatus.notionAutomation.idle.message");
}

function initialUserAction(
  runtime: NotionAutomationRuntime,
  registryStore: NotionRegistryStore | null,
  projectId: string,
  locale: DirongLocale,
): string | null {
  if (!runtime.settings.enabled) {
    return t(locale, "runtimeStatus.notionAutomation.disabled.action");
  }
  if (runtime.settings.uploadMode !== "automatic_after_ai_cleanup") {
    return t(locale, "runtimeStatus.notionAutomation.manual.action");
  }
  if (!isConfigured(runtime, registryStore, projectId)) {
    return t(locale, "runtimeStatus.notionAutomation.notConfigured.action");
  }
  return null;
}

function makeSnapshot(
  snapshot: NotionAutomationSnapshot,
  locale: DirongLocale,
): NotionAutomationSnapshot {
  const technicalDetail =
    snapshot.technicalDetail === null
      ? null
      : redactSensitiveText(snapshot.technicalDetail);
  return cloneSnapshot(localizeNotionAutomationSnapshot({
    ...snapshot,
    technicalDetail,
  }, locale));
}

function cloneSnapshot(
  snapshot: NotionAutomationSnapshot,
): NotionAutomationSnapshot {
  return {
    ...snapshot,
    display: snapshot.display
      ? {
          ...snapshot.display,
          details: snapshot.display.details.map((detail) => ({ ...detail })),
        }
      : undefined,
    inFlightDraftIds: [...snapshot.inFlightDraftIds],
  };
}

function buildNotionAutomationDisplay(
  locale: DirongLocale,
  snapshot: NotionAutomationSnapshot,
): HumanStatusDisplay {
  return buildHumanStatusDisplay(locale, {
    ...notionAutomationDisplayKeys(snapshot.status),
    status: snapshot.status,
    message: snapshot.message,
    userAction: snapshot.userAction,
    technicalDetail: snapshot.technicalDetail,
    details: [
      { label: "uploadMode", value: snapshot.uploadMode },
      { label: "sessionId", value: snapshot.sessionId },
      { label: "draftId", value: snapshot.draftId },
      { label: "targetId", value: snapshot.targetId },
      { label: "writeId", value: snapshot.writeId },
      { label: "pageUrl", value: snapshot.pageUrl },
      { label: "lastRunStatus", value: snapshot.lastRunStatus },
      { label: "inFlightDraftIds", value: snapshot.inFlightDraftIds },
      { label: "repairedExpiredLeases", value: snapshot.repairedExpiredLeases },
    ],
  });
}

function localizeNotionAutomationSnapshot(
  snapshot: NotionAutomationSnapshot,
  locale: DirongLocale,
): NotionAutomationSnapshot {
  const message = t(locale, notionAutomationMessageKey(snapshot.status));
  const userActionKey = notionAutomationUserActionKey(snapshot.status);
  const localized = {
    ...snapshot,
    message,
    userAction: userActionKey ? t(locale, userActionKey) : null,
  };
  return {
    ...localized,
    display: buildNotionAutomationDisplay(locale, localized),
  };
}

function notionAutomationMessageKey(
  status: NotionAutomationStatus,
): LocaleKey {
  switch (status) {
    case "disabled":
      return "runtimeStatus.notionAutomation.disabled.message";
    case "manual":
      return "runtimeStatus.notionAutomation.manual.message";
    case "not_configured":
      return "runtimeStatus.notionAutomation.notConfigured.message";
    case "running":
      return "runtimeStatus.notionAutomation.running.message";
    case "done":
      return "runtimeStatus.notionAutomation.done.message";
    case "not_claimed":
      return "runtimeStatus.notionAutomation.notClaimed.message";
    case "retry_wait":
      return "runtimeStatus.notionAutomation.retryWait.message";
    case "blocked":
      return "runtimeStatus.notionAutomation.blocked.message";
    case "failed":
      return "runtimeStatus.notionAutomation.failed.message";
    case "stopped":
      return "runtimeStatus.notionAutomation.stopped.message";
    case "idle":
    default:
      return "runtimeStatus.notionAutomation.idle.message";
  }
}

function notionAutomationUserActionKey(
  status: NotionAutomationStatus,
): LocaleKey | null {
  switch (status) {
    case "disabled":
      return "runtimeStatus.notionAutomation.disabled.action";
    case "manual":
      return "runtimeStatus.notionAutomation.manual.action";
    case "not_configured":
      return "runtimeStatus.notionAutomation.notConfigured.action";
    case "retry_wait":
      return "runtimeStatus.notionAutomation.retryWait.action";
    case "blocked":
      return "runtimeStatus.notionAutomation.blocked.action";
    case "failed":
      return "runtimeStatus.notionAutomation.failed.action";
    default:
      return null;
  }
}

function notionAutomationDisplayKeys(
  status: NotionAutomationStatus,
): Pick<
  HumanStatusDisplayInput,
  "titleKey" | "descriptionKey" | "nextActionKey"
> {
  if (status === "disabled") {
    return {
      titleKey: "statusDisplay.notion.disabled.title",
      descriptionKey: "statusDisplay.notion.disabled.description",
      nextActionKey: "statusDisplay.notion.disabled.nextAction",
    };
  }
  if (status === "manual") {
    return {
      titleKey: "statusDisplay.notion.manual.title",
      descriptionKey: "statusDisplay.notion.manual.description",
      nextActionKey: "statusDisplay.notion.manual.nextAction",
    };
  }
  if (status === "not_configured") {
    return {
      titleKey: "statusDisplay.notion.notConfigured.title",
      descriptionKey: "statusDisplay.notion.notConfigured.description",
      nextActionKey: "statusDisplay.notion.notConfigured.nextAction",
    };
  }
  if (status === "running") {
    return {
      titleKey: "statusDisplay.notion.running.title",
      descriptionKey: "statusDisplay.notion.running.description",
    };
  }
  if (status === "done") {
    return {
      titleKey: "statusDisplay.notion.done.title",
      descriptionKey: "statusDisplay.notion.done.description",
    };
  }
  if (status === "retry_wait") {
    return {
      titleKey: "statusDisplay.notion.retryWait.title",
      descriptionKey: "statusDisplay.notion.retryWait.description",
      nextActionKey: "statusDisplay.notion.retryWait.nextAction",
    };
  }
  if (status === "blocked") {
    return {
      titleKey: "statusDisplay.notion.blocked.title",
      descriptionKey: "statusDisplay.notion.blocked.description",
      nextActionKey: "statusDisplay.notion.blocked.nextAction",
    };
  }
  if (status === "failed") {
    return {
      titleKey: "statusDisplay.notion.failed.title",
      descriptionKey: "statusDisplay.notion.failed.description",
      nextActionKey: "statusDisplay.notion.failed.nextAction",
    };
  }
  if (status === "not_claimed") {
    return {
      titleKey: "statusDisplay.notion.notClaimed.title",
      descriptionKey: "statusDisplay.notion.notClaimed.description",
    };
  }
  return {
    titleKey: "statusDisplay.notion.idle.title",
    descriptionKey: "statusDisplay.notion.idle.description",
  };
}

function cleanRequiredString(value: string | null, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
  const cleaned = value.trim();
  if (!cleaned) {
    throw new Error(`${label} must not be empty.`);
  }
  return cleaned;
}
