import { redactSensitiveText, summarizeSafeError } from "../errors.js";
import {
  buildHumanStatusDisplay,
  formatHumanStatusDisplayForText,
  type HumanStatusDisplay,
  type HumanStatusDisplayInput,
} from "../messages/human-status.js";
import { PollingLoop } from "../runtime/polling-loop.js";
import {
  NotionApiError,
  type NotionClient,
} from "./client.js";
import type { NotionCustomPropertyRule } from "./property-rules.js";
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
  registryStore?: NotionRegistryStore | null;
  customPropertyRules?: () => readonly NotionCustomPropertyRule[];
  retention?: NotionUploadRetentionHandler;
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
    this.snapshot = makeSnapshot({
      enabled: runtime.settings.enabled,
      configured: isConfigured(runtime, options.registryStore ?? null),
      uploadMode: runtime.settings.uploadMode,
      status: initialStatus(runtime, options.registryStore ?? null),
      checkedAt: null,
      sessionId: null,
      draftId: null,
      targetId: null,
      writeId: null,
      pageUrl: null,
      message: initialMessage(runtime, options.registryStore ?? null),
      userAction: initialUserAction(runtime, options.registryStore ?? null),
      technicalDetail: null,
      lastRunStatus: null,
      inFlightDraftIds: [],
      repairedExpiredLeases: 0,
    });
    this.loop = new PollingLoop({
      intervalMs: options.pollIntervalMs,
      runTick: () => this.tick(),
      onScheduledError: (error) => {
        this.snapshot = makeSnapshot({
          ...this.snapshot,
          status: "failed",
          checkedAt: new Date().toISOString(),
          message: "Notion 자동 업로드 확인 중 오류가 발생했습니다.",
          userAction: "local draft는 보존됩니다. Notion 설정과 로그를 확인해 주세요.",
          technicalDetail: summarizeSafeError(error),
        });
      },
    });
  }

  start(): void {
    if (!shouldRun(this.getRuntime(), this.options.registryStore ?? null)) {
      return;
    }
    this.loop.start();
  }

  async stop(): Promise<void> {
    await this.loop.stop();
    this.snapshot = makeSnapshot({
      ...this.snapshot,
      status: "stopped",
      checkedAt: new Date().toISOString(),
      message: "Notion 자동 업로드 중지됨",
      userAction: null,
      inFlightDraftIds: this.getInFlightDraftIds(),
    });
  }

  getSnapshot(): NotionAutomationSnapshot {
    return cloneSnapshot(this.snapshot);
  }

  async runOnce(): Promise<NotionAutomationSnapshot> {
    const blocked = blockedSnapshot(
      this.getRuntime(),
      this.options.registryStore ?? null,
      this.snapshot,
    );
    if (blocked) {
      this.snapshot = blocked;
      return this.getSnapshot();
    }

    return await this.loop.runOnce();
  }

  private async tick(): Promise<NotionAutomationSnapshot> {
    const runtime = this.getRuntime();
    const checkedAt = new Date().toISOString();
    const repairedExpiredLeases =
      this.options.writeStore.releaseExpiredLeases(checkedAt);

    if (this.inFlightDraftIds.size > 0) {
      this.snapshot = makeSnapshot({
        ...this.snapshot,
        status: "running",
        checkedAt,
        message: "Notion 업로드 진행 중",
        userAction: null,
        repairedExpiredLeases,
        inFlightDraftIds: this.getInFlightDraftIds(),
      });
      return this.getSnapshot();
    }

    const target = await resolveAutomationTargetId(
      runtime.settings,
      runtime.client,
      this.options.registryStore ?? null,
    );
    if (!target.ok) {
      this.snapshot = makeSnapshot({
        ...this.snapshot,
        status: target.status,
        checkedAt,
        targetId: null,
        message: target.message,
        userAction: target.userAction,
        technicalDetail: target.technicalDetail,
        repairedExpiredLeases,
        inFlightDraftIds: this.getInFlightDraftIds(),
      });
      return this.getSnapshot();
    }

    const candidates =
      this.options.readModel.listLatestValidDraftsMissingDoneWrite({
        targetId: target.targetId,
        limit: this.options.batchLimit,
      });
    const candidate = candidates.find(
      (item) => !this.inFlightDraftIds.has(item.id),
    );
    if (!candidate) {
      this.snapshot = makeSnapshot({
        ...this.snapshot,
        status: "idle",
        checkedAt,
        sessionId: null,
        draftId: null,
        targetId: target.targetId,
        writeId: null,
        pageUrl: null,
        message: "Notion 자동 업로드 대기 중: 업로드할 valid draft 없음",
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
    );
  }

  private async runForDraft(
    candidate: NotionDraftCandidateRow,
    targetId: string,
    repairedExpiredLeases: number,
    runtime: NotionAutomationRuntime,
  ): Promise<NotionAutomationSnapshot> {
    this.inFlightDraftIds.add(candidate.id);
    this.snapshot = makeSnapshot({
      ...this.snapshot,
      status: "running",
      checkedAt: new Date().toISOString(),
      sessionId: candidate.session_id,
      draftId: candidate.id,
      targetId,
      message: "Notion 자동 업로드 실행 중",
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
        customPropertyRules: this.options.customPropertyRules?.() ?? [],
      });
      await applyRetentionAfterSuccessfulUpload(
        this.options.retention,
        result,
      );
      this.snapshot = snapshotFromRunResult({
        previous: this.snapshot,
        result,
        repairedExpiredLeases,
      });
    } catch (error) {
      this.snapshot = makeSnapshot({
        ...this.snapshot,
        status: "failed",
        checkedAt: new Date().toISOString(),
        message: "Notion 자동 업로드 중 오류가 발생했습니다. local draft는 보존됩니다.",
        userAction:
          "Notion 설정과 dashboard의 최신 Notion write 상태를 확인한 뒤 수동 Retry를 시도해 주세요.",
        technicalDetail: summarizeSafeError(error),
        repairedExpiredLeases,
      });
    } finally {
      this.inFlightDraftIds.delete(candidate.id);
      this.snapshot = makeSnapshot({
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
}

export function formatNotionAutomationForStatus(
  snapshot: NotionAutomationSnapshot,
): string {
  const display = snapshot.display ?? buildNotionAutomationDisplay(snapshot);
  const lines = [
    formatHumanStatusDisplayForText(display, {
      title: "Notion 자동 업로드",
      description: "설명",
      nextAction: "Notion 조치",
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
    lines.push(`Notion lease 복구: ${snapshot.repairedExpiredLeases}개`);
  }
  return lines.join("\n");
}

function snapshotFromRunResult(input: {
  previous: NotionAutomationSnapshot;
  result: NotionUploadResult;
  repairedExpiredLeases: number;
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
  });
}

async function resolveAutomationTargetId(
  settings: NotionRuntimeSettings,
  client: NotionClient | null,
  registryStore: NotionRegistryStore | null,
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
  const registryBlock = blockPartialManagedNotionRegistry(registryStore);
  if (registryBlock) {
    return {
      ok: false,
      status: "blocked",
      message: registryBlock.message,
      userAction: registryBlock.userAction,
      technicalDetail: registryBlock.technicalDetail,
    };
  }

  const managedMeeting = hasCompleteManagedNotionUploadRegistry(registryStore)
    ? registryStore?.getManagedDatabase("meeting")
    : null;
  if (managedMeeting) {
    return { ok: true, targetId: managedMeeting.dataSourceId };
  }

  if (!settings.targetUrl) {
    return {
      ok: false,
      status: "not_configured",
      message: "Notion target URL is missing.",
      userAction:
        "managed Notion DB를 생성하거나 전환기 fallback용 NOTION_TARGET_URL을 설정해 주세요.",
      technicalDetail: null,
    };
  }

  const parsed = parseNotionTargetUrl(settings.targetUrl);
  if (parsed.kind === "invalid") {
    return {
      ok: false,
      status: "not_configured",
      message: "Notion target URL is invalid.",
      userAction:
        "Notion 데이터베이스 또는 data source URL을 다시 복사해 붙여넣어 주세요.",
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
      userAction: "NOTION_API_KEY 설정을 확인해 주세요.",
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
        userAction:
          "Notion database에 data source가 여러 개이면 업로드할 data source URL을 직접 복사해 주세요.",
        technicalDetail: `child data source count: ${dataSources.length}`,
      };
    }
    const targetId = readId(dataSources[0]);
    if (!targetId) {
      return {
        ok: false,
        status: "blocked",
        message: "Notion data source id is missing.",
        userAction: "Notion data source URL을 다시 복사해 붙여넣어 주세요.",
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

function blockedSnapshot(
  runtime: NotionAutomationRuntime,
  registryStore: NotionRegistryStore | null,
  previous: NotionAutomationSnapshot,
): NotionAutomationSnapshot | null {
  const checkedAt = new Date().toISOString();
  if (!runtime.settings.enabled) {
    return makeSnapshot({
      ...previous,
      enabled: false,
      configured: isConfigured(runtime, registryStore),
      uploadMode: runtime.settings.uploadMode,
      status: "disabled",
      checkedAt,
      message: "Notion export is disabled.",
      userAction: "자동 업로드를 쓰려면 NOTION_EXPORT_ENABLED=true로 켜 주세요.",
      technicalDetail: null,
    });
  }
  if (runtime.settings.uploadMode !== "automatic_after_ai_cleanup") {
    return makeSnapshot({
      ...previous,
      enabled: true,
      configured: isConfigured(runtime, registryStore),
      uploadMode: runtime.settings.uploadMode,
      status: "manual",
      checkedAt,
      message: "Notion upload is in manual mode.",
      userAction:
        "자동 업로드를 쓰려면 NOTION_UPLOAD_MODE=automatic_after_ai_cleanup으로 설정해 주세요.",
      technicalDetail: null,
    });
  }
  if (!isConfigured(runtime, registryStore)) {
    return makeSnapshot({
      ...previous,
      enabled: true,
      configured: false,
      uploadMode: runtime.settings.uploadMode,
      status: "not_configured",
      checkedAt,
      message: "Notion automatic upload settings are incomplete.",
      userAction:
        "NOTION_API_KEY와 NOTION_TARGET_URL을 설정한 뒤 다시 시작해 주세요.",
      technicalDetail: null,
    });
  }
  return null;
}

function shouldRun(
  runtime: NotionAutomationRuntime,
  registryStore: NotionRegistryStore | null,
): boolean {
  return (
    runtime.settings.enabled &&
    runtime.settings.uploadMode === "automatic_after_ai_cleanup" &&
    isConfigured(runtime, registryStore)
  );
}

function isConfigured(
  runtime: NotionAutomationRuntime,
  registryStore: NotionRegistryStore | null,
): boolean {
  return Boolean(
    runtime.settings.apiKey &&
      (runtime.settings.targetUrl ||
        hasCompleteManagedNotionUploadRegistry(registryStore)) &&
      runtime.client,
  );
}

function initialStatus(
  runtime: NotionAutomationRuntime,
  registryStore: NotionRegistryStore | null,
): NotionAutomationStatus {
  if (!runtime.settings.enabled) {
    return "disabled";
  }
  if (runtime.settings.uploadMode !== "automatic_after_ai_cleanup") {
    return "manual";
  }
  if (!isConfigured(runtime, registryStore)) {
    return "not_configured";
  }
  return "idle";
}

function initialMessage(
  runtime: NotionAutomationRuntime,
  registryStore: NotionRegistryStore | null,
): string {
  if (!runtime.settings.enabled) {
    return "Notion export is disabled.";
  }
  if (runtime.settings.uploadMode !== "automatic_after_ai_cleanup") {
    return "Notion upload is in manual mode.";
  }
  if (!isConfigured(runtime, registryStore)) {
    return "Notion automatic upload settings are incomplete.";
  }
  return "Notion 자동 업로드 대기 중";
}

function initialUserAction(
  runtime: NotionAutomationRuntime,
  registryStore: NotionRegistryStore | null,
): string | null {
  if (!runtime.settings.enabled) {
    return "자동 업로드를 쓰려면 NOTION_EXPORT_ENABLED=true로 켜 주세요.";
  }
  if (runtime.settings.uploadMode !== "automatic_after_ai_cleanup") {
    return "자동 업로드를 쓰려면 NOTION_UPLOAD_MODE=automatic_after_ai_cleanup으로 설정해 주세요.";
  }
  if (!isConfigured(runtime, registryStore)) {
    return "NOTION_API_KEY와 NOTION_TARGET_URL을 설정한 뒤 다시 시작해 주세요.";
  }
  return null;
}

function makeSnapshot(
  snapshot: NotionAutomationSnapshot,
): NotionAutomationSnapshot {
  const technicalDetail =
    snapshot.technicalDetail === null
      ? null
      : redactSensitiveText(snapshot.technicalDetail);
  return cloneSnapshot({
    ...snapshot,
    technicalDetail,
    display: buildNotionAutomationDisplay({
      ...snapshot,
      technicalDetail,
    }),
  });
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
  snapshot: NotionAutomationSnapshot,
): HumanStatusDisplay {
  return buildHumanStatusDisplay(undefined, {
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
