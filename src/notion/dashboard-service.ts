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
  withDefaultNotionMemberRelationRule,
} from "./property-rules.js";
import {
  buildNotionSchemaDiff,
  buildNotionSchemaUpdatePlan,
  type NotionSchemaApplyOptions,
  type NotionSchemaDiff,
} from "./schema-manager.js";
import { parseNotionPageUrl, parseNotionTargetUrl } from "./target.js";
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

export type NotionDashboardSchemaActionResult = {
  ok: boolean;
  status: string;
  message: string;
  userAction: string | null;
  warnings: string[];
  diff: NotionSchemaDiff | null;
  operations: {
    create: number;
    rename: number;
    updateType: number;
    updateOptions: number;
    delete: number;
  } | null;
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
      customPropertyRules: this.propertyRuleStore.listEnabledRules(),
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
      message: `Notion 사용자 속성 규칙 ${result.saved}개를 저장하고 ${result.deleted}개를 삭제했습니다.`,
      userAction:
        result.ignored > 0
          ? `${result.ignored}개 항목은 필수 속성이거나 이름이 비어 있어 건너뛰었습니다.`
          : null,
      warnings: result.warnings,
    });
  }

  async inspectSchema(): Promise<NotionDashboardSchemaActionResult> {
    const context = await this.loadSchemaContext();
    if (!context.ok) {
      return context.result;
    }
    return {
      ok: true,
      status: "done",
      message: formatSchemaDiffMessage(context.diff),
      userAction: schemaDiffUserAction(context.diff),
      warnings: context.diff.warnings,
      diff: context.diff,
      operations: null,
    };
  }

  async applySchema(
    options: NotionSchemaApplyOptions,
  ): Promise<NotionDashboardSchemaActionResult> {
    const context = await this.loadSchemaContext();
    if (!context.ok) {
      return context.result;
    }

    const plan = buildNotionSchemaUpdatePlan(context.diff, options);
    if (!plan.body) {
      return {
        ok: plan.blocked.length === 0,
        status: plan.blocked.length > 0 ? "blocked" : "done",
        message:
          plan.blocked.length > 0
            ? "자동 적용할 수 없는 Notion schema 항목이 있습니다."
            : "Notion schema에 적용할 변경이 없습니다.",
        userAction:
          plan.blocked.length > 0
            ? plan.blocked.join(" ")
            : schemaDiffUserAction(context.diff),
        warnings: [...plan.warnings, ...plan.blocked],
        diff: context.diff,
        operations: plan.operations,
      };
    }

    try {
      const updated = await context.client.updateDataSource(context.target.id, plan.body);
      const properties = readDataSourceProperties(updated);
      if (Object.keys(properties).length > 0) {
        this.propertyRuleStore.syncDataSourceProperties({
          properties,
          requiredPropertyNames: this.input.settings.propertyNames,
          nowIso: new Date().toISOString(),
        });
      }
      const after = Object.keys(properties).length > 0
        ? buildNotionSchemaDiff({
            properties,
            propertyNames: this.input.settings.propertyNames,
            customRules: (
              await resolveRelationRuleTargets(
                context.client,
                this.propertyRuleStore.listRules(),
              )
            ).rules,
          })
        : context.diff;
      return {
        ok: plan.blocked.length === 0,
        status: plan.blocked.length > 0 ? "partial" : "done",
        message: formatSchemaApplyMessage(plan.operations),
        userAction:
          plan.blocked.length > 0
            ? plan.blocked.join(" ")
            : schemaDiffUserAction(after),
        warnings: [...plan.warnings, ...plan.blocked],
        diff: after,
        operations: plan.operations,
      };
    } catch (error) {
      return {
        ok: false,
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
        userAction:
          error instanceof NotionApiError
            ? error.userAction
            : "Notion 연결과 target 공유 상태를 확인해 주세요.",
        warnings: plan.warnings,
        diff: context.diff,
        operations: plan.operations,
      };
    }
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
    const storedRules = this.propertyRuleStore.listRules();
    const rules = withDefaultNotionMemberRelationRule(storedRules);
    const enabledCount = rules.filter(
      (rule) => rule.enabled && ruleHasOutput(rule),
    ).length;
    const promptPreview = buildNotionCustomPropertyPrompt(rules);
    return {
      supportedTypes: SUPPORTED_NOTION_CUSTOM_PROPERTY_TYPES,
      requiredPropertyNames: Object.values(this.input.settings.propertyNames),
      rules,
      enabledCount,
      promptPreview,
      message:
        storedRules.length === 0
          ? "기본 Members relation 규칙이 준비되어 있습니다. 대상 DB URL을 입력해 주세요."
          : `사용자 속성 ${rules.length}개 중 ${enabledCount}개가 켜져 있습니다.`,
      userAction:
        storedRules.length === 0
          ? "Members DB를 만들고 대상 DB/data source URL을 입력한 뒤 저장해 주세요."
          : null,
    };
  }

  private async loadSchemaContext(): Promise<
    | {
        ok: true;
        client: NotionClient;
        target: { id: string; dataSource: Record<string, unknown> };
        diff: NotionSchemaDiff;
      }
    | { ok: false; result: NotionDashboardSchemaActionResult }
  > {
    const settings = this.input.settings;
    if (!settings.enabled || !settings.apiKey || !settings.targetUrl) {
      return {
        ok: false,
        result: schemaActionErrorResult({
          status: "not_configured",
          message: "Notion 설정이 완료된 뒤 schema를 정리할 수 있습니다.",
          userAction: "NOTION_API_KEY와 NOTION_TARGET_URL을 확인해 주세요.",
        }),
      };
    }

    const parsedTarget = parseNotionTargetUrl(settings.targetUrl);
    if (parsedTarget.kind === "invalid") {
      return {
        ok: false,
        result: schemaActionErrorResult({
          status: "not_configured",
          message: "Notion target URL is invalid.",
          userAction: "Notion 데이터베이스 또는 data source URL을 다시 복사해 붙여넣어 주세요.",
        }),
      };
    }

    const client = createNotionClient({
      apiKey: settings.apiKey,
      apiVersion: settings.apiVersion,
      baseUrl: settings.baseUrl,
    });

    try {
      const target = await resolveDataSourceTarget(client, parsedTarget);
      const relationResolution = await resolveRelationRuleTargets(
        client,
        this.propertyRuleStore.listRules(),
      );
      const diff = buildNotionSchemaDiff({
        properties: readDataSourceProperties(target.dataSource),
        propertyNames: settings.propertyNames,
        customRules: relationResolution.rules,
      });
      if (relationResolution.warnings.length > 0) {
        diff.warnings.push(...relationResolution.warnings);
      }
      return { ok: true, client, target, diff };
    } catch (error) {
      return {
        ok: false,
        result: schemaActionErrorResult({
          status: "failed",
          message: error instanceof Error ? error.message : String(error),
          userAction:
            error instanceof NotionApiError
              ? error.userAction
              : "Notion 연결과 target 공유 상태를 확인해 주세요.",
        }),
      };
    }
  }
}

async function resolveRelationRuleTargets(
  client: NotionClient,
  rules: readonly NotionCustomPropertyRule[],
): Promise<{ rules: NotionCustomPropertyRule[]; warnings: string[] }> {
  const warnings: string[] = [];
  const resolved: NotionCustomPropertyRule[] = [];
  for (const rule of rules) {
    if (rule.propertyType !== "relation") {
      resolved.push(rule);
      continue;
    }
    let nextRule = rule;
    if (rule.relationTargetPageUrl && !rule.relationTargetPageId) {
      const parsedPage = parseNotionPageUrl(rule.relationTargetPageUrl);
      if (parsedPage.kind === "page_id") {
        nextRule = { ...nextRule, relationTargetPageId: parsedPage.id };
      } else {
        warnings.push(`${rule.propertyName}: relation 대상 page URL을 읽지 못했습니다.`);
      }
    }
    if (!rule.relationTargetUrl) {
      resolved.push(nextRule);
      continue;
    }
    const parsed = parseNotionTargetUrl(rule.relationTargetUrl);
    if (parsed.kind === "invalid") {
      warnings.push(`${rule.propertyName}: relation 대상 URL을 읽지 못했습니다.`);
      resolved.push(nextRule);
      continue;
    }
    try {
      const target = await resolveDataSourceTarget(client, parsed);
      resolved.push({ ...nextRule, relationDataSourceId: target.id });
    } catch (error) {
      warnings.push(
        `${rule.propertyName}: relation 대상 DB에 접근하지 못했습니다 (${error instanceof Error ? error.message : String(error)}).`,
      );
      resolved.push(nextRule);
    }
  }
  return { rules: resolved, warnings };
}

function ruleHasOutput(rule: NotionCustomPropertyRule): boolean {
  if (rule.valueSource === "participants") {
    return true;
  }
  if (rule.promptDescription.trim().length > 0) {
    return true;
  }
  if (rule.propertyType !== "relation") {
    return false;
  }
  if (rule.relationTargetPageId) {
    return true;
  }
  return rule.relationTargetPageUrl
    ? parseNotionPageUrl(rule.relationTargetPageUrl).kind === "page_id"
    : false;
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
  return (await resolveDataSourceTarget(client, parsedTarget)).dataSource;
}

async function resolveDataSourceTarget(
  client: NotionClient,
  parsedTarget: Exclude<ReturnType<typeof parseNotionTargetUrl>, { kind: "invalid" }>,
): Promise<{ id: string; dataSource: Record<string, unknown> }> {
  if (parsedTarget.kind === "data_source_id") {
    return {
      id: parsedTarget.id,
      dataSource: await client.retrieveDataSource(parsedTarget.id),
    };
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
  return {
    id: dataSourceId,
    dataSource: await client.retrieveDataSource(dataSourceId),
  };
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

function schemaActionErrorResult(input: {
  status: string;
  message: string;
  userAction: string | null;
}): NotionDashboardSchemaActionResult {
  return {
    ok: false,
    status: input.status,
    message: input.message,
    userAction: input.userAction,
    warnings: [],
    diff: null,
    operations: null,
  };
}

function formatSchemaDiffMessage(diff: NotionSchemaDiff): string {
  return [
    `누락 ${diff.missing.length}`,
    `이름변경 ${diff.renames.length}`,
    `타입불일치 ${diff.wrongType.length}`,
    `옵션누락 ${diff.missingOptions.length}`,
    `관리외 ${diff.extra.length}`,
  ].join(" / ");
}

function formatSchemaApplyMessage(
  operations: NonNullable<NotionDashboardSchemaActionResult["operations"]>,
): string {
  return [
    `생성 ${operations.create}`,
    `이름변경 ${operations.rename}`,
    `타입변경 ${operations.updateType}`,
    `옵션보강 ${operations.updateOptions}`,
    `삭제 ${operations.delete}`,
  ].join(" / ");
}

function schemaDiffUserAction(diff: NotionSchemaDiff): string | null {
  if (
    diff.missing.length === 0 &&
    diff.renames.length === 0 &&
    diff.wrongType.length === 0 &&
    diff.missingOptions.length === 0
  ) {
    return diff.extra.length > 0
      ? "관리 외 속성은 보기만 했습니다. 지우려면 삭제 옵션을 명시적으로 켜 주세요."
      : null;
  }
  return "스키마 맞추기를 누르면 누락 속성과 이름 변경, select 옵션 보강을 자동 적용합니다.";
}
