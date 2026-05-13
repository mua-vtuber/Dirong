import type { IncomingMessage, ServerResponse } from "node:http";
import { ManagedSchemaRepairStalePlanError } from "../notion/managed-schema-repair.js";
import type { NotionCustomPropertyRuleInput } from "../notion/property-rules.js";
import type { NotionSchemaApplyOptions } from "../notion/schema-manager.js";
import {
  NOTION_DATABASE_ROLES,
  type NotionDatabaseRole,
} from "../notion/schema-presets.js";
import {
  isRecord,
  readJsonBody,
  readOptionalBodyString,
  sendJson,
  withMessageKeys,
} from "./http.js";
import type { DashboardRuntimeSources } from "./server.js";
import type { DirongLocale } from "../settings/local-settings-store.js";

function sendNotionMissingResponse(
  response: ServerResponse,
  locale: DirongLocale,
  extra: Record<string, unknown>,
): void {
  sendJson(response, withMessageKeys(locale, {
    ok: false,
    status: "not_configured",
    messageKey: "error.dashboard.notionActionSourceMissing.message",
    userActionKey: "error.dashboard.notionActionSourceMissing.action",
    ...extra,
  }));
}

function sendInvalidRequestResponse(
  response: ServerResponse,
  locale: DirongLocale,
  error: unknown,
  extra: Record<string, unknown>,
): void {
  const message = error instanceof Error ? error.message : String(error);
  sendJson(response, {
    ok: false,
    ...extra,
    ...withMessageKeys(locale, {
      messageKey: "error.dashboard.requestInvalid.message",
      userActionKey: "action.request.retry",
      status: "failed",
      technicalDetail: message,
    }),
  }, 400);
}

export async function handleNotionAction(
  request: IncomingMessage,
  response: ServerResponse,
  sources: DashboardRuntimeSources,
  locale: DirongLocale,
  force: boolean,
): Promise<void> {
  if (!sources.notion) {
    sendNotionMissingResponse(response, locale, {
      pageUrl: null,
    });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const result = await sources.notion.runManualUpload({
      sessionId: readOptionalBodyString(body, "sessionId"),
      draftId: readOptionalBodyString(body, "draftId"),
      force,
    }, locale);
    sendJson(response, result);
  } catch (error) {
    sendInvalidRequestResponse(response, locale, error, {
      pageUrl: null,
    });
  }
}

export async function handleNotionPropertiesSync(
  request: IncomingMessage,
  response: ServerResponse,
  sources: DashboardRuntimeSources,
  locale: DirongLocale,
): Promise<void> {
  if (!sources.notion) {
    sendNotionMissingResponse(response, locale, {
      warnings: [],
      customProperties: null,
    });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const result = await sources.notion.syncCustomProperties({
      role: readOptionalNotionDatabaseRole(body, "targetDatabaseRole"),
    });
    sendJson(response, result);
  } catch (error) {
    sendInvalidRequestResponse(response, locale, error, {
      warnings: [],
      customProperties: null,
    });
  }
}

export async function handleNotionMemberRosterSync(
  response: ServerResponse,
  sources: DashboardRuntimeSources,
  locale: DirongLocale,
): Promise<void> {
  if (!sources.notion) {
    sendNotionMissingResponse(response, locale, {
      dataSourceId: null,
      syncedAt: null,
      memberCount: 0,
      roleCount: 0,
      warnings: [],
    });
    return;
  }

  try {
    sendJson(response, await sources.notion.syncMemberRoster());
  } catch (error) {
    sendInvalidRequestResponse(response, locale, error, {
      dataSourceId: null,
      syncedAt: null,
      memberCount: 0,
      roleCount: 0,
      warnings: [],
    });
  }
}

export async function handleNotionPropertiesSave(
  request: IncomingMessage,
  response: ServerResponse,
  sources: DashboardRuntimeSources,
  locale: DirongLocale,
): Promise<void> {
  if (!sources.notion) {
    sendNotionMissingResponse(response, locale, {
      warnings: [],
      customProperties: null,
    });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const result = sources.notion.saveCustomPropertyRules({
      role: readOptionalNotionDatabaseRole(body, "targetDatabaseRole"),
      rules: readCustomPropertyRuleInputs(body),
    });
    sendJson(response, result);
  } catch (error) {
    sendInvalidRequestResponse(response, locale, error, {
      warnings: [],
      customProperties: null,
    });
  }
}

export async function handleNotionSchemaInspect(
  response: ServerResponse,
  sources: DashboardRuntimeSources,
  locale: DirongLocale,
): Promise<void> {
  if (!sources.notion) {
    sendNotionMissingResponse(response, locale, {
      warnings: [],
      diff: null,
      operations: null,
    });
    return;
  }

  const result = await sources.notion.inspectSchema();
  sendJson(response, result);
}

export async function handleNotionSchemaApply(
  request: IncomingMessage,
  response: ServerResponse,
  sources: DashboardRuntimeSources,
  locale: DirongLocale,
): Promise<void> {
  if (!sources.notion) {
    sendNotionMissingResponse(response, locale, {
      warnings: [],
      diff: null,
      operations: null,
    });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const result = await sources.notion.applySchema(
      readNotionSchemaApplyOptions(body),
    );
    sendJson(response, result);
  } catch (error) {
    sendInvalidRequestResponse(response, locale, error, {
      warnings: [],
      diff: null,
      operations: null,
    });
  }
}

export async function handleNotionManagedSchemaCheck(
  response: ServerResponse,
  sources: DashboardRuntimeSources,
  locale: DirongLocale,
): Promise<void> {
  if (!sources.notion) {
    sendNotionMissingResponse(response, locale, {
      snapshot: null,
      plans: null,
    });
    return;
  }

  try {
    sendJson(response, await sources.notion.checkManagedSchemaWithPlans());
  } catch (error) {
    sendInvalidRequestResponse(response, locale, error, {
      snapshot: null,
      plans: null,
    });
  }
}

export async function handleNotionManagedSchemaRepair(
  request: IncomingMessage,
  response: ServerResponse,
  sources: DashboardRuntimeSources,
  locale: DirongLocale,
): Promise<void> {
  if (!sources.notion) {
    sendNotionMissingResponse(response, locale, {
      snapshot: null,
    });
    return;
  }

  try {
    const body = await readJsonBody(request);
    sendJson(response, await sources.notion.repairManagedSchema({
      role: readNotionDatabaseRole(body),
      confirm: isRecord(body) && body.confirm === true,
      expectedPlanHash: readRequiredBodyString(body, "expectedPlanHash"),
      operations: readOptionalStringArray(body, "operations"),
    }));
  } catch (error) {
    if (error instanceof ManagedSchemaRepairStalePlanError) {
      sendJson(response, {
        ok: false,
        status: "stale_plan",
        message: "Managed schema repair plan이 최신 상태가 아닙니다.",
        userAction: "Notion 상태를 다시 확인한 뒤 복구 계획을 다시 적용해 주세요.",
        expectedPlanHash: error.expectedPlanHash,
        actualPlanHash: error.actualPlanHash,
        snapshot: null,
      }, 409);
      return;
    }
    sendInvalidRequestResponse(response, locale, error, {
      snapshot: null,
    });
  }
}

function readCustomPropertyRuleInputs(
  body: unknown,
): NotionCustomPropertyRuleInput[] {
  if (!isRecord(body) || !Array.isArray(body.rules)) {
    return [];
  }

  const rules: NotionCustomPropertyRuleInput[] = [];
  for (const entry of body.rules) {
    if (!isRecord(entry) || typeof entry.propertyName !== "string") {
      continue;
    }
    rules.push({
      originalPropertyName:
        typeof entry.originalPropertyName === "string"
          ? entry.originalPropertyName
          : null,
      propertyName: entry.propertyName,
      propertyType:
        typeof entry.propertyType === "string" ? entry.propertyType : null,
      valueSource:
        typeof entry.valueSource === "string" ? entry.valueSource : null,
      enabled: entry.enabled === true,
      promptDescription:
        typeof entry.promptDescription === "string"
          ? entry.promptDescription
          : "",
      maxLength:
        typeof entry.maxLength === "number" && Number.isFinite(entry.maxLength)
          ? entry.maxLength
          : null,
      relationTargetUrl:
        typeof entry.relationTargetUrl === "string"
          ? entry.relationTargetUrl
          : null,
      relationDataSourceId:
        typeof entry.relationDataSourceId === "string"
          ? entry.relationDataSourceId
          : null,
      relationTargetPageUrl:
        typeof entry.relationTargetPageUrl === "string"
          ? entry.relationTargetPageUrl
          : null,
      relationTargetPageId:
        typeof entry.relationTargetPageId === "string"
          ? entry.relationTargetPageId
          : null,
      relationMatchPropertyName:
        typeof entry.relationMatchPropertyName === "string"
          ? entry.relationMatchPropertyName
          : null,
      relationAutoCreate: entry.relationAutoCreate === true,
      deleted: entry.deleted === true,
    });
  }
  return rules;
}

function readNotionSchemaApplyOptions(body: unknown): NotionSchemaApplyOptions {
  const record = isRecord(body) ? body : {};
  return {
    createMissing: record.createMissing !== false,
    updateTypes: record.updateTypes === true,
    deleteExtra: false,
    confirmDeleteExtra: false,
  };
}

function readNotionDatabaseRole(body: unknown): NotionDatabaseRole {
  if (!isRecord(body) || typeof body.role !== "string") {
    throw new Error("role is required.");
  }
  if ((NOTION_DATABASE_ROLES as readonly string[]).includes(body.role)) {
    return body.role as NotionDatabaseRole;
  }
  throw new Error(`Invalid Notion database role: ${body.role}`);
}

function readOptionalNotionDatabaseRole(
  body: unknown,
  key: string,
): NotionDatabaseRole {
  if (!isRecord(body) || typeof body[key] !== "string") {
    return "meeting";
  }
  if ((NOTION_DATABASE_ROLES as readonly string[]).includes(body[key])) {
    return body[key] as NotionDatabaseRole;
  }
  throw new Error(`Invalid Notion database role: ${body[key]}`);
}

function readRequiredBodyString(body: unknown, key: string): string {
  if (!isRecord(body) || typeof body[key] !== "string" || !body[key].trim()) {
    throw new Error(`${key} is required.`);
  }
  return body[key].trim();
}

function readOptionalStringArray(body: unknown, key: string): string[] | undefined {
  if (!isRecord(body) || !Array.isArray(body[key])) {
    return undefined;
  }
  return body[key]
    .map((value) => typeof value === "string" ? value.trim() : "")
    .filter((value): value is string => value.length > 0);
}
