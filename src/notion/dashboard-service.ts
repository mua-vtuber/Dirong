import type { Phase1Config } from "../config.js";
import { createNotionClient } from "./client.js";
import { NotionDraftInputReadModel } from "./draft-input-read-model.js";
import type { NotionRuntimeSettings } from "./settings.js";
import { snapshotNotionRuntimeSettings } from "./settings.js";
import { runNotionUpload, type NotionDraftSelector } from "./writer.js";
import { NotionWriteStore } from "./write-store.js";
import { SqlRunner } from "../storage/sql-runner.js";
import type { DirongDatabase } from "../storage/sqlite.js";

export type NotionDashboardSnapshot = {
  enabled: boolean;
  configured: boolean;
  status: "disabled" | "not_configured" | "ready";
  uploadMode: string;
  targetUrl: string | null;
  message: string;
  userAction: string | null;
  settings: ReturnType<typeof snapshotNotionRuntimeSettings>;
};

export type NotionDashboardActionInput = {
  sessionId: string | null;
  draftId: string | null;
  force: boolean;
};

export type NotionDashboardActionResult = {
  ok: boolean;
  status: string;
  message: string;
  userAction: string | null;
  pageUrl: string | null;
};

export class NotionDashboardService {
  constructor(
    private readonly input: {
      settings: NotionRuntimeSettings;
      database: DirongDatabase;
      config: Pick<Phase1Config, "sttLeaseMs">;
      workerId: string;
    },
  ) {}

  getSnapshot(): NotionDashboardSnapshot {
    const settings = this.input.settings;
    const configured = Boolean(settings.apiKey && settings.targetUrl);
    if (!settings.enabled) {
      return {
        enabled: false,
        configured,
        status: "disabled",
        uploadMode: settings.uploadMode,
        targetUrl: settings.targetUrl,
        message: "Notion upload is disabled.",
        userAction: "NOTION_EXPORT_ENABLED=true로 켤 수 있습니다.",
        settings: snapshotNotionRuntimeSettings(settings),
      };
    }
    if (!configured) {
      return {
        enabled: true,
        configured: false,
        status: "not_configured",
        uploadMode: settings.uploadMode,
        targetUrl: settings.targetUrl,
        message: "Notion upload settings are incomplete.",
        userAction: "NOTION_API_KEY와 NOTION_TARGET_URL을 설정해 주세요.",
        settings: snapshotNotionRuntimeSettings(settings),
      };
    }
    return {
      enabled: true,
      configured: true,
      status: "ready",
      uploadMode: settings.uploadMode,
      targetUrl: settings.targetUrl,
      message: "Notion upload is configured.",
      userAction: null,
      settings: snapshotNotionRuntimeSettings(settings),
    };
  }

  async runManualUpload(
    action: NotionDashboardActionInput,
  ): Promise<NotionDashboardActionResult> {
    const selector = selectorFromAction(action);
    if (!selector) {
      return {
        ok: false,
        status: "failed",
        message: "sessionId 또는 draftId가 필요합니다.",
        userAction: "회의 세션이나 draft가 생긴 뒤 다시 시도해 주세요.",
        pageUrl: null,
      };
    }

    const settings = this.input.settings;
    const runner = new SqlRunner(this.input.database);
    const client = settings.apiKey
      ? createNotionClient({
          apiKey: settings.apiKey,
          apiVersion: settings.apiVersion,
          baseUrl: settings.baseUrl,
        })
      : null;
    const result = await runNotionUpload({
      settings,
      selector,
      dryRun: false,
      force: action.force,
      workerId: this.input.workerId,
      leaseMs: settings.leaseMs || this.input.config.sttLeaseMs,
      client,
      readModel: new NotionDraftInputReadModel(runner),
      writeStore: new NotionWriteStore(runner),
    });

    return {
      ok: ["done", "retry_wait", "not_claimed"].includes(result.status),
      status: result.status,
      message: result.message,
      userAction: result.userAction,
      pageUrl: result.pageUrl,
    };
  }
}

function selectorFromAction(
  action: NotionDashboardActionInput,
): NotionDraftSelector | null {
  if (action.draftId) {
    return { kind: "draft", draftId: action.draftId };
  }
  if (action.sessionId) {
    return { kind: "session", sessionId: action.sessionId };
  }
  return null;
}
