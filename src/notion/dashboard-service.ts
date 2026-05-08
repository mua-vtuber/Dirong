import type { Phase1Config } from "../config.js";
import {
  createNotionClient,
  NotionApiError,
  type NotionClient,
} from "./client.js";
import { NotionDraftInputReadModel } from "./draft-input-read-model.js";
import type { NotionRuntimeSettings } from "./settings.js";
import { snapshotNotionRuntimeSettings } from "./settings.js";
import type { NotionDataSourceProperties } from "./schema.js";
import {
  buildNotionCustomPropertyPrompt,
  NotionCustomPropertyRuleStore,
  SUPPORTED_NOTION_CUSTOM_PROPERTY_TYPES,
  type NotionCustomPropertyRule,
  type NotionCustomPropertyRuleInput,
} from "./property-rules.js";
import { parseNotionTargetUrl } from "./target.js";
import { runNotionUpload, type NotionDraftSelector } from "./writer.js";
import { NotionWriteStore } from "./write-store.js";
import { SqlRunner } from "../storage/sql-runner.js";
import type { DirongDatabase } from "../storage/sqlite.js";

export type NotionCustomPropertiesDashboardSnapshot = {
  supportedTypes: readonly string[];
  requiredPropertyNames: string[];
  rules: NotionCustomPropertyRule[];
  enabledCount: number;
  promptPreview: string;
  message: string;
  userAction: string | null;
};

export type NotionDashboardSnapshot = {
  enabled: boolean;
  configured: boolean;
  status: "disabled" | "not_configured" | "ready";
  uploadMode: string;
  targetUrl: string | null;
  message: string;
  userAction: string | null;
  settings: ReturnType<typeof snapshotNotionRuntimeSettings>;
  customProperties: NotionCustomPropertiesDashboardSnapshot;
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

export type NotionDashboardCustomPropertyActionResult = {
  ok: boolean;
  status: string;
  message: string;
  userAction: string | null;
  warnings: string[];
  customProperties: NotionCustomPropertiesDashboardSnapshot;
};

export class NotionDashboardService {
  private readonly runner: SqlRunner;
  private readonly propertyRuleStore: NotionCustomPropertyRuleStore;

  constructor(
    private readonly input: {
      settings: NotionRuntimeSettings;
      database: DirongDatabase;
      config: Pick<Phase1Config, "sttLeaseMs">;
      workerId: string;
    },
  ) {
    this.runner = new SqlRunner(input.database);
    this.propertyRuleStore = new NotionCustomPropertyRuleStore(this.runner);
  }

  getSnapshot(): NotionDashboardSnapshot {
    const settings = this.input.settings;
    const configured = Boolean(settings.apiKey && settings.targetUrl);
    const customProperties = this.getCustomPropertiesSnapshot();
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
        customProperties,
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
        customProperties,
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
      customProperties,
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
      readModel: new NotionDraftInputReadModel(this.runner),
      writeStore: new NotionWriteStore(this.runner),
    });

    return {
      ok: ["done", "retry_wait", "not_claimed"].includes(result.status),
      status: result.status,
      message: result.message,
      userAction: result.userAction,
      pageUrl: result.pageUrl,
    };
  }

  async syncCustomProperties(): Promise<NotionDashboardCustomPropertyActionResult> {
    const settings = this.input.settings;
    if (!settings.enabled || !settings.apiKey || !settings.targetUrl) {
      return this.customPropertyActionResult({
        ok: false,
        status: "not_configured",
        message: "Notion 설정이 완료된 뒤 속성 스키마를 불러올 수 있습니다.",
        userAction: "NOTION_API_KEY와 NOTION_TARGET_URL을 확인해 주세요.",
      });
    }

    const client = createNotionClient({
      apiKey: settings.apiKey,
      apiVersion: settings.apiVersion,
      baseUrl: settings.baseUrl,
    });
    const parsedTarget = parseNotionTargetUrl(settings.targetUrl);
    if (parsedTarget.kind === "invalid") {
      return this.customPropertyActionResult({
        ok: false,
        status: "not_configured",
        message: "Notion target URL is invalid.",
        userAction: "Notion 데이터베이스 또는 data source URL을 다시 복사해 붙여넣어 주세요.",
      });
    }

    try {
      const dataSource = await resolveDataSource(client, parsedTarget);
      const syncResult = this.propertyRuleStore.syncDataSourceProperties({
        properties: readDataSourceProperties(dataSource),
        requiredPropertyNames: settings.propertyNames,
        nowIso: new Date().toISOString(),
      });
      return this.customPropertyActionResult({
        ok: true,
        status: "done",
        message: `Notion 속성 ${syncResult.discovered}개를 확인했고 사용자 속성 ${syncResult.custom}개를 관리 목록에 반영했습니다.`,
        userAction: null,
      });
    } catch (error) {
      return this.customPropertyActionResult({
        ok: false,
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
        userAction:
          error instanceof NotionApiError
            ? error.userAction
            : "Notion 연결과 target 공유 상태를 확인해 주세요.",
      });
    }
  }

  saveCustomPropertyRules(
    rules: readonly NotionCustomPropertyRuleInput[],
  ): NotionDashboardCustomPropertyActionResult {
    const result = this.propertyRuleStore.saveRules({
      rules,
      requiredPropertyNames: this.input.settings.propertyNames,
      nowIso: new Date().toISOString(),
    });
    return this.customPropertyActionResult({
      ok: true,
      status: "done",
      message: `Notion 사용자 속성 규칙 ${result.saved}개를 저장했습니다.`,
      userAction:
        result.ignored > 0
          ? `${result.ignored}개 항목은 필수 속성이거나 아직 동기화되지 않아 건너뛰었습니다.`
          : null,
      warnings: result.warnings,
    });
  }

  private customPropertyActionResult(input: {
    ok: boolean;
    status: string;
    message: string;
    userAction: string | null;
    warnings?: string[];
  }): NotionDashboardCustomPropertyActionResult {
    return {
      ...input,
      warnings: input.warnings ?? [],
      customProperties: this.getCustomPropertiesSnapshot(),
    };
  }

  private getCustomPropertiesSnapshot(): NotionCustomPropertiesDashboardSnapshot {
    const rules = this.propertyRuleStore.listRules();
    const enabledCount = rules.filter(
      (rule) => rule.enabled && rule.promptDescription.trim().length > 0,
    ).length;
    const promptPreview = buildNotionCustomPropertyPrompt(rules);
    return {
      supportedTypes: SUPPORTED_NOTION_CUSTOM_PROPERTY_TYPES,
      requiredPropertyNames: Object.values(this.input.settings.propertyNames),
      rules,
      enabledCount,
      promptPreview,
      message:
        rules.length === 0
          ? "Notion 속성을 아직 불러오지 않았습니다."
          : `사용자 속성 ${rules.length}개 중 ${enabledCount}개가 켜져 있습니다.`,
      userAction:
        rules.length === 0
          ? "스키마 다시 불러오기를 눌러 Notion DB 속성을 가져와 주세요."
          : null,
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

async function resolveDataSource(
  client: NotionClient,
  parsedTarget: Exclude<ReturnType<typeof parseNotionTargetUrl>, { kind: "invalid" }>,
): Promise<Record<string, unknown>> {
  if (parsedTarget.kind === "data_source_id") {
    return client.retrieveDataSource(parsedTarget.id);
  }

  const database = await client.retrieveDatabase(parsedTarget.id);
  const dataSources = readDataSources(database);
  if (dataSources.length !== 1) {
    throw new Error("Notion database must contain exactly one child data source.");
  }
  const dataSourceId = readId(dataSources[0]);
  if (!dataSourceId) {
    throw new Error("Notion data source id is missing.");
  }
  return client.retrieveDataSource(dataSourceId);
}

function readDataSourceProperties(
  dataSource: Record<string, unknown>,
): NotionDataSourceProperties {
  const properties = dataSource.properties;
  return isRecord(properties) ? properties as NotionDataSourceProperties : {};
}

function readDataSources(database: Record<string, unknown>): unknown[] {
  return Array.isArray(database.data_sources) ? database.data_sources : [];
}

function readId(value: unknown): string | null {
  return isRecord(value) && typeof value.id === "string" ? value.id : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
