import { createHash } from "node:crypto";
import type { JsonObject, NotionClient } from "./client.js";
import { readDataSourceProperties } from "./data-source-readers.js";
import { managedSelectOptionSchema } from "./property-shape.js";
import {
  buildManagedSchemaDiff,
  type ManagedSchemaDiff,
  type ManagedSchemaIssue,
} from "./managed-schema-diff.js";
import {
  KOREAN_NOTION_SCHEMA_PRESET,
  type NotionDatabaseRole,
  type NotionPropertySemanticKey,
  type NotionSchemaPreset,
  type NotionSchemaPresetProperty,
} from "./schema-presets.js";
import type {
  NotionManagedDatabase,
  NotionPropertyMapping,
  NotionRegistryStore,
} from "./registry-store.js";

export class ManagedSchemaRepairStalePlanError extends Error {
  constructor(
    public readonly expectedPlanHash: string,
    public readonly actualPlanHash: string,
  ) {
    super("Managed Notion schema repair plan is stale.");
    this.name = "ManagedSchemaRepairStalePlanError";
  }
}

export type ManagedSchemaRepairOperationKind =
  | "create_property"
  | "rename_property"
  | "append_options"
  | "sync_mapping";

export type ManagedSchemaRepairOperation = {
  id: string;
  kind: ManagedSchemaRepairOperationKind;
  semanticKey: NotionPropertySemanticKey;
  propertyName: string;
  propertyId: string | null;
  propertyType: string;
  description: string;
  patchKey: string | null;
  patch: JsonObject | null;
};

export type ManagedSchemaRepairBlockedItem = {
  id: string;
  semanticKey: NotionPropertySemanticKey | null;
  code: ManagedSchemaIssue["code"];
  propertyName: string;
  reason: string;
};

export type ManagedSchemaRepairPlan = {
  role: NotionDatabaseRole;
  status: "empty" | "ready" | "blocked";
  planHash: string;
  operations: ManagedSchemaRepairOperation[];
  blocked: ManagedSchemaRepairBlockedItem[];
  warnings: string[];
  body: { properties: Record<string, unknown> } | null;
};

export type ManagedSchemaRepairResult = {
  ok: boolean;
  status: "done" | "blocked" | "failed";
  message: string;
  userAction: string | null;
  plan: ManagedSchemaRepairPlan;
  appliedOperationIds: string[];
  registryUpdated: Array<{
    semanticKey: NotionPropertySemanticKey;
    propertyId: string | null;
    propertyName: string;
    propertyType: string;
  }>;
  diff: ManagedSchemaDiff;
};

export async function applyManagedSchemaRepair(input: {
  client: NotionClient;
  registryStore: NotionRegistryStore;
  role: NotionDatabaseRole;
  expectedPlanHash: string;
  projectId?: string;
  operationIds?: readonly string[];
  nowIso?: string;
  preset?: NotionSchemaPreset;
}): Promise<ManagedSchemaRepairResult> {
  const context = await loadRepairContext(input);
  const plan = buildManagedSchemaRepairPlan(context);
  if (plan.planHash !== input.expectedPlanHash) {
    throw new ManagedSchemaRepairStalePlanError(
      input.expectedPlanHash,
      plan.planHash,
    );
  }

  const selectedOperations = selectOperations(plan, input.operationIds);
  const selectedPlan = rebuildPlanForOperations(context.role, selectedOperations, plan);
  if (selectedOperations.length === 0) {
    return {
      ok: selectedPlan.blocked.length === 0,
      status: selectedPlan.blocked.length > 0 ? "blocked" : "done",
      message:
        selectedPlan.blocked.length > 0
          ? "자동 복구할 수 없는 managed schema 항목이 있습니다."
          : "적용할 managed schema 복구 작업이 없습니다.",
      userAction:
        selectedPlan.blocked.length > 0
          ? selectedPlan.blocked.map((item) => item.reason).join(" ")
          : null,
      plan: selectedPlan,
      appliedOperationIds: [],
      registryUpdated: [],
      diff: context.diff,
    };
  }

  if (selectedPlan.body) {
    await input.client.updateDataSource(
      context.managedDatabase.dataSourceId,
      selectedPlan.body,
    );
  }
  for (const operation of selectedOperations) {
    if (isMeetingActionItemsCreateOperation(context.role, operation)) {
      await createMeetingActionItemsViaTaskRelation({
        client: input.client,
        managedDatabases: context.managedDatabases,
        preset: context.preset ?? KOREAN_NOTION_SCHEMA_PRESET,
      });
    }
  }

  const afterDataSource = await input.client.retrieveDataSource(
    context.managedDatabase.dataSourceId,
  );
  const afterDiff = buildManagedSchemaDiff({
    databaseRole: input.role,
    properties: readDataSourceProperties(afterDataSource),
    mappings: input.registryStore.listPropertyMappings(
      undefined,
      input.projectId,
    ),
    managedDatabases: input.registryStore.listManagedDatabases(input.projectId),
    preset: input.preset,
  });
  const unresolvedSelectedIssues = unresolvedIssuesForOperations({
    diff: afterDiff,
    operations: selectedOperations,
  });
  const updatedMappings = upsertResolvedMappings({
    registryStore: input.registryStore,
    role: input.role,
    projectId: input.projectId,
    diff: afterDiff,
    operations: selectedOperations,
    nowIso: input.nowIso ?? new Date().toISOString(),
    preset: input.preset ?? KOREAN_NOTION_SCHEMA_PRESET,
  });
  if (unresolvedSelectedIssues.length > 0) {
    return {
      ok: false,
      status: "failed",
      message: `managed schema 복구 후에도 ${unresolvedSelectedIssues.length}개 항목이 남아 있습니다.`,
      userAction:
        `${unresolvedSelectedIssues
          .map((issue) => issue.propertyName)
          .join(", ")} 항목이 Notion 응답에서 확인되지 않았습니다. ` +
        "DB 설정 화면에서 상태를 다시 확인해 주세요.",
      plan: selectedPlan,
      appliedOperationIds: selectedOperations.map((operation) => operation.id),
      registryUpdated: updatedMappings,
      diff: afterDiff,
    };
  }

  return {
    ok: true,
    status: "done",
    message: `managed schema 복구 작업 ${selectedOperations.length}개를 적용했습니다.`,
    userAction: afterDiff.status === "healthy"
      ? null
      : "남은 항목은 Notion에서 직접 확인하거나 다시 복구 계획을 확인해 주세요.",
    plan: selectedPlan,
    appliedOperationIds: selectedOperations.map((operation) => operation.id),
    registryUpdated: updatedMappings,
    diff: afterDiff,
  };
}

export function buildManagedSchemaRepairPlan(input: {
  role: NotionDatabaseRole;
  diff: ManagedSchemaDiff;
  mappings: readonly NotionPropertyMapping[];
  managedDatabases: readonly NotionManagedDatabase[];
  preset?: NotionSchemaPreset;
}): ManagedSchemaRepairPlan {
  const preset = input.preset ?? KOREAN_NOTION_SCHEMA_PRESET;
  const mappingsByKey = new Map(
    input.mappings.map((mapping) => [mapping.semanticKey, mapping]),
  );
  const resolvedByKey = new Map(
    input.diff.resolvedProperties.map((property) => [
      property.semanticKey,
      property,
    ]),
  );
  const operations: ManagedSchemaRepairOperation[] = [];
  const blocked: ManagedSchemaRepairBlockedItem[] = [];
  const warnings = [...input.diff.warnings];
  const operatedKeys = new Set<NotionPropertySemanticKey>();

  for (const issue of input.diff.issues) {
    if (issue.code === "extra") {
      continue;
    }
    if (!issue.semanticKey) {
      continue;
    }
    const property = presetProperty(input.role, issue.semanticKey, preset);
    if (!property) {
      blocked.push(blockedItem(issue, "preset에서 semantic key를 찾지 못했습니다."));
      continue;
    }

    if (issue.code === "mapping_missing") {
      if (input.diff.issues.some(
        (entry) =>
          entry.semanticKey === issue.semanticKey &&
          entry.code === "remote_missing",
      )) {
        continue;
      }
      const resolved = resolvedByKey.get(issue.semanticKey);
      if (resolved && !operatedKeys.has(issue.semanticKey)) {
        operations.push({
          id: operationId("sync_mapping", issue.semanticKey),
          kind: "sync_mapping",
          semanticKey: issue.semanticKey,
          propertyName: resolved.propertyName,
          propertyId: resolved.propertyId,
          propertyType: resolved.propertyType,
          description: `${issue.semanticKey} registry mapping을 remote property로 동기화`,
          patchKey: null,
          patch: null,
        });
        operatedKeys.add(issue.semanticKey);
      }
      continue;
    }

    if (issue.code === "remote_missing") {
      if (property.type === "title") {
        blocked.push(blockedItem(issue, "title property는 API로 새로 만들 수 없습니다."));
        continue;
      }
      const patch = schemaForProperty({
        property,
        mappingsByKey,
        managedDatabases: input.managedDatabases,
      });
      if (!patch) {
        blocked.push(blockedItem(issue, "relation/rollup dependency를 확인할 수 없습니다."));
        continue;
      }
      operations.push({
        id: operationId("create_property", issue.semanticKey),
        kind: "create_property",
        semanticKey: issue.semanticKey,
        propertyName: issue.propertyName || property.name,
        propertyId: null,
        propertyType: property.type,
        description: `${issue.semanticKey} Notion property 생성`,
        patchKey: isMeetingActionItemsProperty(input.role, property)
          ? null
          : issue.propertyName || property.name,
        patch: isMeetingActionItemsProperty(input.role, property) ? null : patch,
      });
      operatedKeys.add(issue.semanticKey);
      continue;
    }

    if (issue.code === "name_drift") {
      operations.push({
        id: operationId("rename_property", issue.semanticKey),
        kind: "rename_property",
        semanticKey: issue.semanticKey,
        propertyName: issue.expected ?? property.name,
        propertyId: issue.propertyId ?? null,
        propertyType: property.type,
        description: `${issue.semanticKey} Notion property 이름 복구`,
        patchKey: issue.propertyId ?? issue.actual ?? issue.propertyName,
        patch: { name: issue.expected ?? property.name },
      });
      operatedKeys.add(issue.semanticKey);
      continue;
    }

    if (issue.code === "option_missing") {
      if (issue.actual === "status") {
        blocked.push(blockedItem(issue, "status option 보강은 Notion에서 직접 확인해야 합니다."));
        continue;
      }
      operations.push({
        id: operationId("append_options", issue.semanticKey),
        kind: "append_options",
        semanticKey: issue.semanticKey,
        propertyName: issue.propertyName,
        propertyId: issue.propertyId ?? null,
        propertyType: issue.actual ?? property.type,
        description: `${issue.semanticKey} Notion option 보강`,
        patchKey: issue.propertyId ?? issue.propertyName,
        patch: {
          [issue.actual === "multi_select" ? "multi_select" : "select"]: {
            options: [
              ...(issue.existingOptions ?? []),
              ...(issue.missingOptions ?? []).map(managedSelectOptionSchema),
            ],
          },
        },
      });
      operatedKeys.add(issue.semanticKey);
      continue;
    }

    blocked.push(blockedItem(issue, "기존 property의 위험한 변경은 자동 처리하지 않습니다."));
  }

  return rebuildPlanForOperations(input.role, operations, {
    blocked,
    warnings,
  });
}

async function loadRepairContext(input: {
  client: NotionClient;
  registryStore: NotionRegistryStore;
  role: NotionDatabaseRole;
  projectId?: string;
  preset?: NotionSchemaPreset;
}): Promise<{
  role: NotionDatabaseRole;
  managedDatabase: NotionManagedDatabase;
  diff: ManagedSchemaDiff;
  mappings: NotionPropertyMapping[];
  managedDatabases: NotionManagedDatabase[];
  preset?: NotionSchemaPreset;
}> {
  const managedDatabase = input.registryStore.getManagedDatabase(
    input.role,
    input.projectId,
  );
  if (!managedDatabase) {
    throw new Error(`${input.role} managed Notion DB registry가 없습니다.`);
  }
  const managedDatabases = input.registryStore.listManagedDatabases(
    input.projectId,
  );
  const mappings = input.registryStore.listPropertyMappings(
    undefined,
    input.projectId,
  );
  const dataSource = await input.client.retrieveDataSource(
    managedDatabase.dataSourceId,
  );
  const diff = buildManagedSchemaDiff({
    databaseRole: input.role,
    properties: readDataSourceProperties(dataSource),
    mappings,
    managedDatabases,
    preset: input.preset,
  });
  return {
    role: input.role,
    managedDatabase,
    diff,
    mappings,
    managedDatabases,
    preset: input.preset,
  };
}

function rebuildPlanForOperations(
  role: NotionDatabaseRole,
  operations: readonly ManagedSchemaRepairOperation[],
  base: Pick<ManagedSchemaRepairPlan, "blocked" | "warnings">,
): ManagedSchemaRepairPlan {
  const properties: Record<string, unknown> = {};
  for (const operation of operations) {
    if (!operation.patchKey || !operation.patch) {
      continue;
    }
    mergePropertyPatch(properties, operation.patchKey, operation.patch);
  }
  const plan: ManagedSchemaRepairPlan = {
    role,
    status:
      base.blocked.length > 0
        ? "blocked"
        : operations.length > 0
          ? "ready"
          : "empty",
    planHash: "",
    operations: [...operations],
    blocked: [...base.blocked],
    warnings: [...base.warnings],
    body: Object.keys(properties).length > 0 ? { properties } : null,
  };
  return {
    ...plan,
    planHash: hashRepairPlan(plan),
  };
}

function selectOperations(
  plan: ManagedSchemaRepairPlan,
  operationIds: readonly string[] | undefined,
): ManagedSchemaRepairOperation[] {
  if (!operationIds || operationIds.length === 0) {
    return plan.operations;
  }
  const selected = new Set(operationIds);
  return plan.operations.filter((operation) => selected.has(operation.id));
}

function upsertResolvedMappings(input: {
  registryStore: NotionRegistryStore;
  role: NotionDatabaseRole;
  projectId?: string;
  diff: ManagedSchemaDiff;
  operations: readonly ManagedSchemaRepairOperation[];
  nowIso: string;
  preset: NotionSchemaPreset;
}): ManagedSchemaRepairResult["registryUpdated"] {
  const updated: ManagedSchemaRepairResult["registryUpdated"] = [];
  const blockingByKey = new Map<NotionPropertySemanticKey, ManagedSchemaIssue[]>();
  for (const issue of input.diff.issues) {
    if (!issue.semanticKey || issue.severity === "warning") {
      continue;
    }
    const issues = blockingByKey.get(issue.semanticKey) ?? [];
    issues.push(issue);
    blockingByKey.set(issue.semanticKey, issues);
  }
  const resolvedByKey = new Map(
    input.diff.resolvedProperties.map((property) => [
      property.semanticKey,
      property,
    ]),
  );

  input.registryStore.transaction(() => {
    for (const operation of input.operations) {
      const resolved = resolvedByKey.get(operation.semanticKey);
      const property = presetProperty(input.role, operation.semanticKey, input.preset);
      const remainingIssues = (blockingByKey.get(operation.semanticKey) ?? [])
        .filter((issue) => issue.code !== "mapping_missing")
        .filter((issue) => !(issue.code === "remote_missing" && resolved));
      if (!resolved || !property || remainingIssues.length > 0) {
        continue;
      }
      input.registryStore.upsertPropertyMapping({
        projectId: input.projectId,
        databaseRole: input.role,
        semanticKey: operation.semanticKey,
        propertyName: resolved.propertyName,
        propertyId: resolved.propertyId,
        propertyType: property.type,
        locked: property.locked,
        sourceKind: property.type === "rollup" ? "rollup" : "system",
        nowIso: input.nowIso,
      });
      updated.push({
        semanticKey: operation.semanticKey,
        propertyId: resolved.propertyId,
        propertyName: resolved.propertyName,
        propertyType: property.type,
      });
    }
  });

  return updated;
}

async function createMeetingActionItemsViaTaskRelation(input: {
  client: NotionClient;
  managedDatabases: readonly NotionManagedDatabase[];
  preset: NotionSchemaPreset;
}): Promise<void> {
  const meeting = requiredManagedDatabase(input.managedDatabases, "meeting");
  const task = requiredManagedDatabase(input.managedDatabases, "task");
  const taskMeeting = requiredPresetProperty(
    input.preset,
    "task",
    "task.meeting",
  );
  const meetingActionItems = requiredPresetProperty(
    input.preset,
    "meeting",
    "meeting.actionItems",
  );

  await input.client.updateDataSource(task.dataSourceId, {
    properties: {
      [taskMeeting.name]: {
        type: "relation",
        relation: {
          data_source_id: meeting.dataSourceId,
          type: "dual_property",
          dual_property: {
            synced_property_name: meetingActionItems.name,
          },
        },
      },
    },
  });

  const meetingDataSource = await input.client.retrieveDataSource(
    meeting.dataSourceId,
  );
  const relation = findRelationToDataSource(
    readDataSourceProperties(meetingDataSource),
    task.dataSourceId,
  );
  if (!relation || relation.name === meetingActionItems.name) {
    return;
  }

  await input.client.updateDataSource(meeting.dataSourceId, {
    properties: {
      [relation.id ?? relation.name]: {
        name: meetingActionItems.name,
      },
    },
  });
}

function isMeetingActionItemsCreateOperation(
  role: NotionDatabaseRole,
  operation: ManagedSchemaRepairOperation,
): boolean {
  return role === "meeting" &&
    operation.kind === "create_property" &&
    operation.semanticKey === "meeting.actionItems";
}

function isMeetingActionItemsProperty(
  role: NotionDatabaseRole,
  property: NotionSchemaPresetProperty,
): boolean {
  return role === "meeting" && property.key === "meeting.actionItems";
}

function requiredManagedDatabase(
  managedDatabases: readonly NotionManagedDatabase[],
  role: NotionDatabaseRole,
): NotionManagedDatabase {
  const database = managedDatabases.find((item) => item.role === role);
  if (!database) {
    throw new Error(`${role} managed Notion DB registry가 없습니다.`);
  }
  return database;
}

function requiredPresetProperty(
  preset: NotionSchemaPreset,
  role: NotionDatabaseRole,
  semanticKey: NotionPropertySemanticKey,
): NotionSchemaPresetProperty {
  const property = presetProperty(role, semanticKey, preset);
  if (!property) {
    throw new Error(`${semanticKey} preset property를 찾지 못했습니다.`);
  }
  return property;
}

function findRelationToDataSource(
  properties: Record<string, unknown>,
  targetDataSourceId: string,
): { id: string | null; name: string } | null {
  for (const [fallbackName, value] of Object.entries(properties)) {
    if (!isRecord(value) || !isRecord(value.relation)) {
      continue;
    }
    if (value.relation.data_source_id !== targetDataSourceId) {
      continue;
    }
    return {
      id: readOptionalString(value, "id"),
      name: readOptionalString(value, "name") ?? fallbackName,
    };
  }
  return null;
}

function unresolvedIssuesForOperations(input: {
  diff: ManagedSchemaDiff;
  operations: readonly ManagedSchemaRepairOperation[];
}): ManagedSchemaIssue[] {
  const operatedKeys = new Set(
    input.operations.map((operation) => operation.semanticKey),
  );
  const resolvedKeys = new Set(
    input.diff.resolvedProperties.map((property) => property.semanticKey),
  );
  return input.diff.issues.filter(
    (issue) =>
      issue.semanticKey !== null &&
      operatedKeys.has(issue.semanticKey) &&
      issue.severity !== "warning" &&
      issue.code !== "mapping_missing" &&
      !(issue.code === "remote_missing" && resolvedKeys.has(issue.semanticKey)),
  );
}

function schemaForProperty(input: {
  property: NotionSchemaPresetProperty;
  mappingsByKey: ReadonlyMap<NotionPropertySemanticKey, NotionPropertyMapping>;
  managedDatabases: readonly NotionManagedDatabase[];
}): JsonObject | null {
  const { property } = input;
  if (property.type === "rich_text") {
    return { type: "rich_text", rich_text: {} };
  }
  if (property.type === "date") {
    return { type: "date", date: {} };
  }
  if (property.type === "people") {
    return { type: "people", people: {} };
  }
  if (property.type === "select") {
    return {
      type: "select",
      select: {
        options: (property.options ?? []).map(managedSelectOptionSchema),
      },
    };
  }
  if (property.type === "multi_select") {
    return {
      type: "multi_select",
      multi_select: {
        options: (property.options ?? []).map(managedSelectOptionSchema),
      },
    };
  }
  if (property.type === "relation") {
    const targetRole = property.relation?.targetDatabase;
    const target = input.managedDatabases.find(
      (database) => database.role === targetRole,
    );
    return target
      ? {
          type: "relation",
          relation: { data_source_id: target.dataSourceId },
        }
      : null;
  }
  if (property.type === "rollup") {
    if (!property.rollup) {
      return null;
    }
    const relation = input.mappingsByKey.get(property.rollup.relationProperty);
    const target = input.mappingsByKey.get(property.rollup.targetProperty);
    if (!relation || !target) {
      return null;
    }
    return {
      type: "rollup",
      rollup: {
        function: "show_original",
        ...(relation.propertyId ? { relation_property_id: relation.propertyId } : {}),
        relation_property_name: relation.propertyName,
        ...(target.propertyId ? { rollup_property_id: target.propertyId } : {}),
        rollup_property_name: target.propertyName,
      },
    };
  }
  return null;
}

function presetProperty(
  role: NotionDatabaseRole,
  semanticKey: NotionPropertySemanticKey,
  preset: NotionSchemaPreset,
): NotionSchemaPresetProperty | null {
  return preset.databases[role].properties.find(
    (property) => property.key === semanticKey,
  ) ?? null;
}

function blockedItem(
  issue: ManagedSchemaIssue,
  reason: string,
): ManagedSchemaRepairBlockedItem {
  return {
    id: `blocked:${issue.code}:${issue.semanticKey ?? issue.propertyName}`,
    semanticKey: issue.semanticKey,
    code: issue.code,
    propertyName: issue.propertyName,
    reason: `${issue.propertyName}: ${reason}`,
  };
}

function mergePropertyPatch(
  properties: Record<string, unknown>,
  patchKey: string,
  patch: JsonObject,
): void {
  const existing = properties[patchKey];
  properties[patchKey] = isRecord(existing)
    ? { ...existing, ...patch }
    : patch;
}

function operationId(
  kind: ManagedSchemaRepairOperationKind,
  semanticKey: NotionPropertySemanticKey,
): string {
  return `${kind}:${semanticKey}`;
}

function hashRepairPlan(plan: Omit<ManagedSchemaRepairPlan, "planHash">): string {
  return createHash("sha256")
    .update(JSON.stringify({
      role: plan.role,
      operations: plan.operations.map((operation) => ({
        id: operation.id,
        kind: operation.kind,
        semanticKey: operation.semanticKey,
        propertyName: operation.propertyName,
        propertyId: operation.propertyId,
        propertyType: operation.propertyType,
        patchKey: operation.patchKey,
        patch: operation.patch,
      })),
      blocked: plan.blocked,
    }))
    .digest("hex");
}

function readOptionalString(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const raw = value[key];
  return typeof raw === "string" && raw.trim() ? raw : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
