import type {
  NotionDataSourceProperties,
  NotionDataSourceProperty,
  NotionSchemaMissingOption,
  NotionSemanticResolvedProperties,
  NotionSemanticSchemaMissing,
  NotionSemanticSchemaValidation,
  NotionSemanticSchemaWrongType,
} from "./schema.js";
import {
  readExistingOptionRefs,
  readPropertyOptionNames,
  readRelationDataSourceId,
} from "./property-shape.js";
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
} from "./registry-store.js";

export type ManagedSchemaIssueCode =
  | "mapping_missing"
  | "remote_missing"
  | "name_drift"
  | "wrong_type"
  | "relation_target_mismatch"
  | "rollup_target_mismatch"
  | "option_missing"
  | "extra";

export type ManagedSchemaIssueSeverity = "repairable" | "manual" | "warning";

export type ManagedSchemaRemoteStatus =
  | "healthy"
  | "needs_repair"
  | "manual_required";

export type ManagedSchemaResolvedProperty = {
  semanticKey: NotionPropertySemanticKey;
  propertyId: string | null;
  propertyName: string;
  propertyType: string;
  match: "id" | "name";
};

export type ManagedSchemaIssue = {
  code: ManagedSchemaIssueCode;
  severity: ManagedSchemaIssueSeverity;
  databaseRole: NotionDatabaseRole;
  semanticKey: NotionPropertySemanticKey | null;
  propertyName: string;
  propertyId?: string | null;
  expected: string | null;
  actual: string | null;
  expectedDataSourceId?: string | null;
  actualDataSourceId?: string | null;
  missingOptions?: string[];
  existingOptions?: Array<Record<string, string>>;
  message: string;
};

export type ManagedSchemaDiff = {
  databaseRole: NotionDatabaseRole;
  expectedPropertyCount: number;
  actualPropertyCount: number;
  resolvedProperties: ManagedSchemaResolvedProperty[];
  issues: ManagedSchemaIssue[];
  warnings: string[];
  status: ManagedSchemaRemoteStatus;
  healthy: boolean;
};

type ManagedActualProperty = {
  key: string;
  id: string | null;
  name: string;
  type: string;
  property: NotionDataSourceProperty;
};

type MatchedProperty = {
  expected: NotionSchemaPresetProperty;
  mapping: NotionPropertyMapping | null;
  actual: ManagedActualProperty | null;
  match: "id" | "name" | null;
};

export function buildManagedSchemaDiff(input: {
  databaseRole: NotionDatabaseRole;
  properties: NotionDataSourceProperties;
  mappings: readonly NotionPropertyMapping[];
  managedDatabases: readonly NotionManagedDatabase[];
  preset?: NotionSchemaPreset;
}): ManagedSchemaDiff {
  const preset = input.preset ?? KOREAN_NOTION_SCHEMA_PRESET;
  const expectedProperties = preset.databases[input.databaseRole].properties;
  const mappingsByKey = new Map(
    input.mappings.map((mapping) => [mapping.semanticKey, mapping]),
  );
  const actualProperties = listActualProperties(input.properties);
  const matchedByKey = new Map<NotionPropertySemanticKey, MatchedProperty>();

  for (const expected of expectedProperties) {
    const mapping = mappingsByKey.get(expected.key) ?? null;
    const found = findActualProperty({
      expected,
      mapping,
      actualProperties,
    });
    matchedByKey.set(expected.key, {
      expected,
      mapping,
      actual: found?.actual ?? null,
      match: found?.match ?? null,
    });
  }

  const issues: ManagedSchemaIssue[] = [];
  for (const match of matchedByKey.values()) {
    collectRequiredPropertyIssues({
      databaseRole: input.databaseRole,
      match,
      managedDatabases: input.managedDatabases,
      matchedByKey,
      mappingsByKey,
      issues,
    });
  }
  collectExtraIssues({
    databaseRole: input.databaseRole,
    actualProperties,
    matchedByKey,
    issues,
  });

  const warnings = issues
    .filter((issue) => issue.severity === "warning")
    .map((issue) => issue.message);
  const status = classifyManagedSchemaDiff(issues);

  return {
    databaseRole: input.databaseRole,
    expectedPropertyCount: expectedProperties.length,
    actualPropertyCount: actualProperties.length,
    resolvedProperties: [...matchedByKey.values()]
      .filter((match): match is MatchedProperty & { actual: ManagedActualProperty; match: "id" | "name" } =>
        match.actual !== null && match.match !== null,
      )
      .map((match) => ({
        semanticKey: match.expected.key,
        propertyId: match.actual.id,
        propertyName: match.actual.name,
        propertyType: match.actual.type,
        match: match.match,
      })),
    issues,
    warnings,
    status,
    healthy: status === "healthy",
  };
}

export function classifyManagedSchemaDiff(
  issues: readonly ManagedSchemaIssue[],
): ManagedSchemaRemoteStatus {
  if (issues.some((issue) => issue.severity === "manual")) {
    return "manual_required";
  }
  if (issues.some((issue) => issue.severity === "repairable")) {
    return "needs_repair";
  }
  return "healthy";
}

export function requiredSemanticKeysForManagedRole(
  role: NotionDatabaseRole,
  preset: NotionSchemaPreset = KOREAN_NOTION_SCHEMA_PRESET,
): NotionPropertySemanticKey[] {
  return preset.databases[role].properties.map((property) => property.key);
}

export function validateManagedDataSourceSchemaForUpload(input: {
  databaseRole: NotionDatabaseRole;
  properties: NotionDataSourceProperties;
  mappings: readonly NotionPropertyMapping[];
  managedDatabases: readonly NotionManagedDatabase[];
  requiredSemanticKeys: readonly NotionPropertySemanticKey[];
  preset?: NotionSchemaPreset;
}): NotionSemanticSchemaValidation {
  const diff = buildManagedSchemaDiff({
    databaseRole: input.databaseRole,
    properties: input.properties,
    mappings: input.mappings,
    managedDatabases: input.managedDatabases,
    preset: input.preset,
  });
  const required = new Set(input.requiredSemanticKeys);
  const missing: NotionSemanticSchemaMissing[] = [];
  const wrongType: NotionSemanticSchemaWrongType[] = [];
  const missingOptions: NotionSchemaMissingOption[] = [];
  const resolved: NotionSemanticResolvedProperties = {};

  for (const property of diff.resolvedProperties) {
    if (required.has(property.semanticKey)) {
      resolved[property.semanticKey] = {
        semanticKey: property.semanticKey,
        id: property.propertyId ?? property.propertyName,
        name: property.propertyName,
        type: property.propertyType,
      };
    }
  }

  for (const issue of diff.issues) {
    if (!issue.semanticKey || !required.has(issue.semanticKey)) {
      continue;
    }
    if (issue.code === "extra") {
      continue;
    }
    if (issue.code === "mapping_missing" || issue.code === "remote_missing") {
      missing.push({
        semanticKey: issue.semanticKey,
        property: issue.propertyName,
      });
      continue;
    }
    if (issue.code === "option_missing") {
      missingOptions.push({
        property: issue.propertyName,
        type: issue.actual ?? "select",
        missingOptions: issue.missingOptions ?? [],
      });
      continue;
    }
    wrongType.push({
      semanticKey: issue.semanticKey,
      property: issue.propertyName,
      expected: issue.expected ?? "managed schema",
      actual: issue.actual ?? "unknown",
    });
  }

  if (
    missing.length === 0 &&
    wrongType.length === 0 &&
    missingOptions.length === 0
  ) {
    return { ok: true, propertyIds: resolved };
  }

  return {
    ok: false,
    missing,
    wrongType,
    missingOptions,
    userAction: buildManagedUploadUserAction({
      missing,
      wrongType,
      missingOptions,
    }),
  };
}

function collectRequiredPropertyIssues(input: {
  databaseRole: NotionDatabaseRole;
  match: MatchedProperty;
  managedDatabases: readonly NotionManagedDatabase[];
  matchedByKey: ReadonlyMap<NotionPropertySemanticKey, MatchedProperty>;
  mappingsByKey: ReadonlyMap<NotionPropertySemanticKey, NotionPropertyMapping>;
  issues: ManagedSchemaIssue[];
}): void {
  const { expected, mapping, actual } = input.match;
  const propertyName = mapping?.propertyName ?? expected.name;
  if (!mapping) {
    input.issues.push({
      code: "mapping_missing",
      severity: "repairable",
      databaseRole: input.databaseRole,
      semanticKey: expected.key,
      propertyName,
      propertyId: null,
      expected: expected.name,
      actual: null,
      message: `${expected.key}: SQLite property mapping이 없습니다.`,
    });
  }

  if (!actual) {
    input.issues.push({
      code: "remote_missing",
      severity: expected.type === "title" ? "manual" : "repairable",
      databaseRole: input.databaseRole,
      semanticKey: expected.key,
      propertyName,
      propertyId: null,
      expected: expected.type,
      actual: null,
      message:
        expected.type === "title"
          ? `${expected.key}: Notion title 속성은 API로 복구할 수 없습니다.`
          : `${expected.key}: Notion property를 찾지 못했습니다.`,
    });
    return;
  }

  if (!acceptedTypes(expected).includes(actual.type)) {
    input.issues.push({
      code: "wrong_type",
      severity: "manual",
      databaseRole: input.databaseRole,
      semanticKey: expected.key,
      propertyName: actual.name,
      propertyId: actual.id,
      expected: expected.type,
      actual: actual.type,
      message: `${expected.key}: Notion property type이 다릅니다 (${actual.type} -> ${expected.type}).`,
    });
    return;
  }

  if (mapping && input.match.match === "id" && actual.name !== mapping.propertyName) {
    input.issues.push({
      code: "name_drift",
      severity: "repairable",
      databaseRole: input.databaseRole,
      semanticKey: expected.key,
      propertyName: actual.name,
      propertyId: actual.id,
      expected: mapping.propertyName,
      actual: actual.name,
      message: `${expected.key}: 연결된 Notion property 이름이 바뀌었습니다.`,
    });
  }

  if (mapping?.propertyId && input.match.match === "name") {
    input.issues.push({
      code: "remote_missing",
      severity: expected.type === "title" ? "manual" : "repairable",
      databaseRole: input.databaseRole,
      semanticKey: expected.key,
      propertyName: actual.name,
      propertyId: actual.id,
      expected: mapping.propertyId,
      actual: actual.id,
      message: `${expected.key}: registry의 property id와 일치하는 Notion property를 찾지 못했고 이름 후보만 찾았습니다.`,
    });
  }

  collectRelationIssue({
    databaseRole: input.databaseRole,
    expected,
    actual,
    managedDatabases: input.managedDatabases,
    issues: input.issues,
  });
  collectRollupIssue({
    databaseRole: input.databaseRole,
    expected,
    actual,
    matchedByKey: input.matchedByKey,
    mappingsByKey: input.mappingsByKey,
    issues: input.issues,
  });
  collectOptionIssue({
    databaseRole: input.databaseRole,
    expected,
    actual,
    issues: input.issues,
  });
}

function buildManagedUploadUserAction(input: {
  missing: readonly NotionSemanticSchemaMissing[];
  wrongType: readonly NotionSemanticSchemaWrongType[];
  missingOptions: readonly NotionSchemaMissingOption[];
}): string {
  const messages: string[] = [];
  if (input.missing.length > 0) {
    messages.push(
      `Managed Notion DB에 필요한 semantic 속성을 확인해 주세요: ${input.missing
        .map((item) => `${item.semanticKey}(${item.property})`)
        .join(", ")}`,
    );
  }
  if (input.wrongType.length > 0) {
    messages.push(
      `Managed Notion DB 속성 타입/관계를 확인해 주세요: ${input.wrongType
        .map(
          (item) =>
            `${item.semanticKey}:${item.property}(${item.actual} -> ${item.expected})`,
        )
        .join(", ")}`,
    );
  }
  if (input.missingOptions.length > 0) {
    messages.push(
      `Managed Notion DB 옵션을 확인해 주세요: ${input.missingOptions
        .map((item) => `${item.property}(${item.missingOptions.join(", ")})`)
        .join(", ")}`,
    );
  }
  messages.push("DB 설정 화면에서 Notion 상태를 다시 확인하고 복구 계획을 적용해 주세요.");
  return messages.join(" ");
}

function collectRelationIssue(input: {
  databaseRole: NotionDatabaseRole;
  expected: NotionSchemaPresetProperty;
  actual: ManagedActualProperty;
  managedDatabases: readonly NotionManagedDatabase[];
  issues: ManagedSchemaIssue[];
}): void {
  if (input.expected.type !== "relation" || !input.expected.relation) {
    return;
  }

  const expectedTarget = input.managedDatabases.find(
    (database) => database.role === input.expected.relation?.targetDatabase,
  );
  const expectedDataSourceId = expectedTarget?.dataSourceId ?? null;
  const actualDataSourceId = readRelationDataSourceId(input.actual.property);
  if (!expectedDataSourceId || actualDataSourceId !== expectedDataSourceId) {
    input.issues.push({
      code: "relation_target_mismatch",
      severity: "manual",
      databaseRole: input.databaseRole,
      semanticKey: input.expected.key,
      propertyName: input.actual.name,
      propertyId: input.actual.id,
      expected: input.expected.relation.targetDatabase,
      actual: actualDataSourceId,
      expectedDataSourceId,
      actualDataSourceId,
      message: `${input.expected.key}: relation 대상 DB/data source가 다릅니다.`,
    });
  }
}

function collectRollupIssue(input: {
  databaseRole: NotionDatabaseRole;
  expected: NotionSchemaPresetProperty;
  actual: ManagedActualProperty;
  matchedByKey: ReadonlyMap<NotionPropertySemanticKey, MatchedProperty>;
  mappingsByKey: ReadonlyMap<NotionPropertySemanticKey, NotionPropertyMapping>;
  issues: ManagedSchemaIssue[];
}): void {
  if (input.expected.type !== "rollup" || !input.expected.rollup) {
    return;
  }

  const rollup = readRollupTarget(input.actual.property);
  const relation = input.matchedByKey.get(input.expected.rollup.relationProperty)?.actual ?? null;
  const targetMapping = input.mappingsByKey.get(input.expected.rollup.targetProperty) ?? null;
  if (
    !rollup ||
    !relation ||
    !targetMapping ||
    !samePropertyReference(rollup.relationPropertyId, rollup.relationPropertyName, relation) ||
    !sameMappingReference(rollup.rollupPropertyId, rollup.rollupPropertyName, targetMapping)
  ) {
    input.issues.push({
      code: "rollup_target_mismatch",
      severity: "manual",
      databaseRole: input.databaseRole,
      semanticKey: input.expected.key,
      propertyName: input.actual.name,
      propertyId: input.actual.id,
      expected: `${input.expected.rollup.relationProperty} -> ${input.expected.rollup.targetProperty}`,
      actual: rollup
        ? `${rollup.relationPropertyName ?? rollup.relationPropertyId ?? "unknown"} -> ${rollup.rollupPropertyName ?? rollup.rollupPropertyId ?? "unknown"}`
        : null,
      message: `${input.expected.key}: rollup relation/target property가 다릅니다.`,
    });
  }
}

function collectOptionIssue(input: {
  databaseRole: NotionDatabaseRole;
  expected: NotionSchemaPresetProperty;
  actual: ManagedActualProperty;
  issues: ManagedSchemaIssue[];
}): void {
  const expectedOptions = input.expected.options ?? [];
  if (expectedOptions.length === 0) {
    return;
  }
  if (
    input.actual.type !== "select" &&
    input.actual.type !== "status" &&
    input.actual.type !== "multi_select"
  ) {
    return;
  }

  const optionNames = readPropertyOptionNames(input.actual.property, input.actual.type);
  const missingOptions = expectedOptions.filter((option) => !optionNames.has(option));
  if (missingOptions.length === 0) {
    return;
  }

  input.issues.push({
    code: "option_missing",
    severity: input.actual.type === "status" ? "manual" : "repairable",
    databaseRole: input.databaseRole,
    semanticKey: input.expected.key,
    propertyName: input.actual.name,
    expected: expectedOptions.join(", "),
    actual: [...optionNames].join(", "),
    missingOptions,
    existingOptions: readExistingOptionRefs(input.actual.property, input.actual.type),
    message: `${input.expected.key}: Notion option이 부족합니다 (${missingOptions.join(", ")}).`,
  });
}

function collectExtraIssues(input: {
  databaseRole: NotionDatabaseRole;
  actualProperties: readonly ManagedActualProperty[];
  matchedByKey: ReadonlyMap<NotionPropertySemanticKey, MatchedProperty>;
  issues: ManagedSchemaIssue[];
}): void {
  const consumed = new Set<ManagedActualProperty>();
  for (const match of input.matchedByKey.values()) {
    if (match.actual) {
      consumed.add(match.actual);
    }
  }

  for (const actual of input.actualProperties) {
    if (consumed.has(actual)) {
      continue;
    }
    input.issues.push({
      code: "extra",
      severity: "warning",
      databaseRole: input.databaseRole,
      semanticKey: null,
      propertyName: actual.name,
      propertyId: actual.id,
      expected: null,
      actual: actual.type,
      message: `${actual.name}: Dirong managed registry에 없는 Notion property입니다. 자동 삭제하지 않습니다.`,
    });
  }
}

function findActualProperty(input: {
  expected: NotionSchemaPresetProperty;
  mapping: NotionPropertyMapping | null;
  actualProperties: readonly ManagedActualProperty[];
}): { actual: ManagedActualProperty; match: "id" | "name" } | null {
  if (input.mapping?.propertyId) {
    const byId = input.actualProperties.find(
      (property) => property.id === input.mapping?.propertyId,
    );
    if (byId) {
      return { actual: byId, match: "id" };
    }
  }

  const expectedNames = [
    input.mapping?.propertyName,
    input.expected.name,
  ].filter((name): name is string => Boolean(name));
  const compatible = input.actualProperties.find(
    (property) =>
      expectedNames.includes(property.key) ||
      expectedNames.includes(property.name),
  );
  if (compatible && acceptedTypes(input.expected).includes(compatible.type)) {
    return { actual: compatible, match: "name" };
  }
  return null;
}

function listActualProperties(
  properties: NotionDataSourceProperties,
): ManagedActualProperty[] {
  return Object.entries(properties).map(([key, property]) => ({
    key,
    id: typeof property.id === "string" ? property.id : null,
    name: cleanInline(property.name ?? key) || key,
    type: cleanInline(property.type ?? "unknown") || "unknown",
    property,
  }));
}

function acceptedTypes(
  expected: Pick<NotionSchemaPresetProperty, "type" | "key">,
): readonly string[] {
  if (expected.key === "meeting.status" || expected.key === "task.status") {
    return ["select", "status"];
  }
  return [expected.type];
}

function readRollupTarget(
  property: NotionDataSourceProperty,
): {
  relationPropertyId: string | null;
  relationPropertyName: string | null;
  rollupPropertyId: string | null;
  rollupPropertyName: string | null;
} | null {
  const rollup = property.rollup;
  if (!isRecord(rollup)) {
    return null;
  }
  return {
    relationPropertyId: readOptionalString(rollup, "relation_property_id"),
    relationPropertyName: readOptionalString(rollup, "relation_property_name"),
    rollupPropertyId: readOptionalString(rollup, "rollup_property_id"),
    rollupPropertyName: readOptionalString(rollup, "rollup_property_name"),
  };
}

function samePropertyReference(
  actualId: string | null,
  actualName: string | null,
  expected: ManagedActualProperty,
): boolean {
  if (actualId && expected.id) {
    return actualId === expected.id;
  }
  return actualName === expected.name || actualName === expected.key;
}

function sameMappingReference(
  actualId: string | null,
  actualName: string | null,
  expected: NotionPropertyMapping,
): boolean {
  if (actualId && expected.propertyId) {
    return actualId === expected.propertyId;
  }
  return actualName === expected.propertyName;
}

function readOptionalString(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const raw = value[key];
  return typeof raw === "string" && raw.trim() ? raw : null;
}

function cleanInline(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
