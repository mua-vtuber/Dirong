import { createHash } from "node:crypto";
import type { JsonObject, NotionClient } from "./client.js";
import { readDataSourceProperties } from "./data-source-readers.js";
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

  const afterDataSource = await input.client.retrieveDataSource(
    context.managedDatabase.dataSourceId,
  );
  const afterDiff = buildManagedSchemaDiff({
    databaseRole: input.role,
    properties: readDataSourceProperties(afterDataSource),
    mappings: input.registryStore.listPropertyMappings(),
    managedDatabases: input.registryStore.listManagedDatabases(),
    preset: input.preset,
  });
  const updatedMappings = upsertResolvedMappings({
    registryStore: input.registryStore,
    role: input.role,
    diff: afterDiff,
    operations: selectedOperations,
    nowIso: input.nowIso ?? new Date().toISOString(),
    preset: input.preset ?? KOREAN_NOTION_SCHEMA_PRESET,
  });

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
        patchKey: issue.propertyName || property.name,
        patch,
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
              ...(issue.missingOptions ?? []).map(selectOptionSchema),
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
  preset?: NotionSchemaPreset;
}): Promise<{
  role: NotionDatabaseRole;
  managedDatabase: NotionManagedDatabase;
  diff: ManagedSchemaDiff;
  mappings: NotionPropertyMapping[];
  managedDatabases: NotionManagedDatabase[];
  preset?: NotionSchemaPreset;
}> {
  const managedDatabase = input.registryStore.getManagedDatabase(input.role);
  if (!managedDatabase) {
    throw new Error(`${input.role} managed Notion DB registry가 없습니다.`);
  }
  const managedDatabases = input.registryStore.listManagedDatabases();
  const mappings = input.registryStore.listPropertyMappings();
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

function schemaForProperty(input: {
  property: NotionSchemaPresetProperty;
  mappingsByKey: ReadonlyMap<NotionPropertySemanticKey, NotionPropertyMapping>;
  managedDatabases: readonly NotionManagedDatabase[];
}): JsonObject | null {
  const { property } = input;
  if (property.type === "rich_text") {
    return { rich_text: {} };
  }
  if (property.type === "date") {
    return { date: {} };
  }
  if (property.type === "people") {
    return { people: {} };
  }
  if (property.type === "select") {
    return {
      select: {
        options: (property.options ?? []).map(selectOptionSchema),
      },
    };
  }
  if (property.type === "multi_select") {
    return {
      multi_select: {
        options: (property.options ?? []).map(selectOptionSchema),
      },
    };
  }
  if (property.type === "relation") {
    const targetRole = property.relation?.targetDatabase;
    const target = input.managedDatabases.find((database) => database.role === targetRole);
    return target ? { relation: { data_source_id: target.dataSourceId } } : null;
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

function selectOptionSchema(name: string): { name: string; color: string } {
  if (name === "done" || name === "완료") {
    return { name, color: "green" };
  }
  if (name === "retry_wait" || name === "진행 중") {
    return { name, color: "yellow" };
  }
  if (name === "failed") {
    return { name, color: "red" };
  }
  return { name, color: "gray" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
