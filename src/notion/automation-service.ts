import { redactSensitiveText } from "../errors.js";
import { PollingLoop } from "../runtime/polling-loop.js";
import type { NotionClient } from "./client.js";
import { NotionApiError } from "./client.js";
import type {
  NotionDraftCandidateRow,
  NotionDraftInputReadModel,
} from "./draft-input-read-model.js";
import type { NotionRuntimeSettings } from "./settings.js";
import { parseNotionTargetUrl } from "./target.js";
import {
  runNotionUpload,
  type NotionUploadResult,
  type NotionUploadStatus,
} from "./writer.js";
import type { NotionWriteStore } from "./write-store.js";

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
  lastRunStatus: NotionUploadStatus | null;
  inFlightDraftIds: string[];
  repairedExpiredLeases: number;
};

export type NotionAutomationServiceOptions = {
  settings: NotionRuntimeSettings;
  client: NotionClient | null;
  readModel: NotionDraftInputReadModel;
  writeStore: NotionWriteStore;
  pollIntervalMs: number;
  batchLimit: number;
  workerId: string;
  leaseMs: number;
};

export class NotionAutomationService {
  private readonly loop: PollingLoop<NotionAutomationSnapshot>;
  private readonly inFlightDraftIds = new Set<string>();
  private snapshot: NotionAutomationSnapshot;

  constructor(private readonly options: NotionAutomationServiceOptions) {
    this.snapshot = makeSnapshot({
      enabled: options.settings.enabled,
      configured: isConfigured(options),
      uploadMode: options.settings.uploadMode,
      status: initialStatus(options),
      checkedAt: null,
      sessionId: null,
      draftId: null,
      targetId: null,
      writeId: null,
      pageUrl: null,
      message: initialMessage(options),
      userAction: initialUserAction(options),
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
          technicalDetail: summarizeError(error),
        });
      },
    });
  }

  start(): void {
    if (!shouldRun(this.options)) {
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
    const blocked = blockedSnapshot(this.options, this.snapshot);
    if (blocked) {
      this.snapshot = blocked;
      return this.getSnapshot();
    }

    return await this.loop.runOnce();
  }

  private async tick(): Promise<NotionAutomationSnapshot> {
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
      this.options.settings,
      this.options.client,
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

    return await this.runForDraft(candidate, target.targetId, repairedExpiredLeases);
  }

  private async runForDraft(
    candidate: NotionDraftCandidateRow,
    targetId: string,
    repairedExpiredLeases: number,
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
        settings: this.options.settings,
        selector: { kind: "draft", draftId: candidate.id },
        dryRun: false,
        force: false,
        workerId: this.options.workerId,
        leaseMs: this.options.leaseMs,
        client: this.options.client,
        readModel: this.options.readModel,
        writeStore: this.options.writeStore,
      });
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
        technicalDetail: summarizeError(error),
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
}

export function formatNotionAutomationForStatus(
  snapshot: NotionAutomationSnapshot,
): string {
  const lines = [
    `Notion 자동 업로드: ${snapshot.message}`,
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
  if (snapshot.userAction) {
    lines.push(`Notion 조치: ${snapshot.userAction}`);
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
  if (!settings.targetUrl) {
    return {
      ok: false,
      status: "not_configured",
      message: "Notion target URL is missing.",
      userAction: "NOTION_TARGET_URL을 설정해 주세요.",
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
    const dataSources = Array.isArray(database.data_sources)
      ? database.data_sources
      : [];
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
    const first = dataSources[0];
    const targetId =
      typeof first === "object" &&
      first !== null &&
      !Array.isArray(first) &&
      typeof (first as { id?: unknown }).id === "string"
        ? (first as { id: string }).id
        : null;
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
  options: NotionAutomationServiceOptions,
  previous: NotionAutomationSnapshot,
): NotionAutomationSnapshot | null {
  const checkedAt = new Date().toISOString();
  if (!options.settings.enabled) {
    return makeSnapshot({
      ...previous,
      enabled: false,
      configured: isConfigured(options),
      uploadMode: options.settings.uploadMode,
      status: "disabled",
      checkedAt,
      message: "Notion export is disabled.",
      userAction: "자동 업로드를 쓰려면 NOTION_EXPORT_ENABLED=true로 켜 주세요.",
      technicalDetail: null,
    });
  }
  if (options.settings.uploadMode !== "automatic_after_ai_cleanup") {
    return makeSnapshot({
      ...previous,
      enabled: true,
      configured: isConfigured(options),
      uploadMode: options.settings.uploadMode,
      status: "manual",
      checkedAt,
      message: "Notion upload is in manual mode.",
      userAction:
        "자동 업로드를 쓰려면 NOTION_UPLOAD_MODE=automatic_after_ai_cleanup으로 설정해 주세요.",
      technicalDetail: null,
    });
  }
  if (!isConfigured(options)) {
    return makeSnapshot({
      ...previous,
      enabled: true,
      configured: false,
      uploadMode: options.settings.uploadMode,
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

function shouldRun(options: NotionAutomationServiceOptions): boolean {
  return (
    options.settings.enabled &&
    options.settings.uploadMode === "automatic_after_ai_cleanup" &&
    isConfigured(options)
  );
}

function isConfigured(options: NotionAutomationServiceOptions): boolean {
  return Boolean(
    options.settings.apiKey &&
      options.settings.targetUrl &&
      options.client,
  );
}

function initialStatus(
  options: NotionAutomationServiceOptions,
): NotionAutomationStatus {
  if (!options.settings.enabled) {
    return "disabled";
  }
  if (options.settings.uploadMode !== "automatic_after_ai_cleanup") {
    return "manual";
  }
  if (!isConfigured(options)) {
    return "not_configured";
  }
  return "idle";
}

function initialMessage(options: NotionAutomationServiceOptions): string {
  if (!options.settings.enabled) {
    return "Notion export is disabled.";
  }
  if (options.settings.uploadMode !== "automatic_after_ai_cleanup") {
    return "Notion upload is in manual mode.";
  }
  if (!isConfigured(options)) {
    return "Notion automatic upload settings are incomplete.";
  }
  return "Notion 자동 업로드 대기 중";
}

function initialUserAction(options: NotionAutomationServiceOptions): string | null {
  if (!options.settings.enabled) {
    return "자동 업로드를 쓰려면 NOTION_EXPORT_ENABLED=true로 켜 주세요.";
  }
  if (options.settings.uploadMode !== "automatic_after_ai_cleanup") {
    return "자동 업로드를 쓰려면 NOTION_UPLOAD_MODE=automatic_after_ai_cleanup으로 설정해 주세요.";
  }
  if (!isConfigured(options)) {
    return "NOTION_API_KEY와 NOTION_TARGET_URL을 설정한 뒤 다시 시작해 주세요.";
  }
  return null;
}

function makeSnapshot(
  snapshot: NotionAutomationSnapshot,
): NotionAutomationSnapshot {
  return cloneSnapshot({
    ...snapshot,
    technicalDetail:
      snapshot.technicalDetail === null
        ? null
        : redactSensitiveText(snapshot.technicalDetail),
  });
}

function cloneSnapshot(
  snapshot: NotionAutomationSnapshot,
): NotionAutomationSnapshot {
  return {
    ...snapshot,
    inFlightDraftIds: [...snapshot.inFlightDraftIds],
  };
}

function summarizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const redacted = redactSensitiveText(message);
  return redacted.length <= 1000 ? redacted : `${redacted.slice(0, 1000)}...`;
}
