import { NOTION_PAGE_STATUS_VALUES } from "./page-properties.js";
import {
  readExistingOptionRefs as readPropertyExistingOptionRefs,
  readPropertyOptionNames,
  readRelationDataSourceId,
  statusOptionSchema,
} from "./property-shape.js";
import {
  isSupportedCustomPropertyType,
  type NotionCustomPropertyRule,
  type NotionCustomPropertyType,
} from "./property-rules.js";
import type {
  NotionDataSourceProperties,
  NotionDataSourceProperty,
  NotionPropertyNameKey,
} from "./schema.js";
import type { NotionPropertyNames } from "./settings.js";
import { formatLocaleText, t } from "../i18n/catalog.js";
import type { DirongLocale } from "../settings/local-settings-store.js";

export type NotionSchemaPropertySource = "required" | "custom";
export type NotionSchemaManagedType =
  | "title"
  | "rich_text"
  | "date"
  | "multi_select"
  | "select"
  | "checkbox"
  | "relation";

export type NotionSchemaDesiredProperty = {
  name: string;
  type: NotionSchemaManagedType;
  accepts: readonly string[];
  source: NotionSchemaPropertySource;
  requiredKey: NotionPropertyNameKey | null;
  optionNames: readonly string[];
  relationDataSourceId: string | null;
};

export type NotionSchemaActualProperty = {
  name: string;
  key: string;
  id: string | null;
  type: string;
  property: NotionDataSourceProperty;
};

export type NotionSchemaMissingProperty = {
  propertyName: string;
  propertyType: NotionSchemaManagedType;
  source: NotionSchemaPropertySource;
  requiredKey: NotionPropertyNameKey | null;
  relationDataSourceId: string | null;
};

export type NotionSchemaRename = {
  fromName: string;
  toName: string;
  propertyId: string | null;
  propertyType: string;
  source: NotionSchemaPropertySource;
  requiredKey: NotionPropertyNameKey | null;
  relationDataSourceId: string | null;
};

export type NotionSchemaWrongType = {
  propertyName: string;
  propertyId: string | null;
  expectedType: string;
  expectedManagedType: NotionSchemaManagedType;
  optionNames: readonly string[];
  relationDataSourceId: string | null;
  actualType: string;
  canUpdate: boolean;
  source: NotionSchemaPropertySource;
  requiredKey: NotionPropertyNameKey | null;
};

export type NotionSchemaMissingOptions = {
  propertyName: string;
  propertyId: string | null;
  propertyType: "select" | "status";
  missingOptions: string[];
  existingOptions: Array<Record<string, string>>;
  canUpdate: boolean;
  source: NotionSchemaPropertySource;
  requiredKey: NotionPropertyNameKey | null;
};

export type NotionSchemaExtraProperty = {
  propertyName: string;
  propertyId: string | null;
  propertyType: string;
  canDelete: boolean;
};

export type NotionSchemaDiff = {
  desired: NotionSchemaDesiredProperty[];
  missing: NotionSchemaMissingProperty[];
  renames: NotionSchemaRename[];
  wrongType: NotionSchemaWrongType[];
  missingOptions: NotionSchemaMissingOptions[];
  extra: NotionSchemaExtraProperty[];
  isCompatible: boolean;
  warnings: string[];
};

export type NotionSchemaApplyOptions = {
  createMissing: boolean;
  updateTypes: boolean;
  deleteExtra: boolean;
  confirmDeleteExtra: boolean;
};

export type NotionSchemaUpdatePlan = {
  body: { properties: Record<string, unknown> } | null;
  operations: {
    create: number;
    rename: number;
    updateType: number;
    updateOptions: number;
    delete: number;
  };
  warnings: string[];
  blocked: string[];
};

type RequiredPropertyRequirement = {
  key: NotionPropertyNameKey;
  type: NotionSchemaManagedType;
  accepts: readonly string[];
  optionNames?: readonly string[];
};

const REQUIRED_PROPERTY_REQUIREMENTS: readonly RequiredPropertyRequirement[] = [
  { key: "title", type: "title", accepts: ["title"] },
  { key: "date", type: "date", accepts: ["date"] },
  { key: "meetingTime", type: "rich_text", accepts: ["rich_text"] },
  { key: "channel", type: "rich_text", accepts: ["rich_text"] },
  { key: "participants", type: "multi_select", accepts: ["multi_select", "rollup"] },
  {
    key: "status",
    type: "select",
    accepts: ["select", "status"],
    optionNames: NOTION_PAGE_STATUS_VALUES,
  },
  { key: "sessionId", type: "rich_text", accepts: ["rich_text"] },
  { key: "draftId", type: "rich_text", accepts: ["rich_text"] },
  { key: "contentHash", type: "rich_text", accepts: ["rich_text"] },
  { key: "localStatus", type: "rich_text", accepts: ["rich_text"] },
];

const IMMUTABLE_API_TYPES = new Set([
  "title",
  "formula",
  "status",
  "synced_content",
  "place",
]);

export function buildNotionSchemaDiff(input: {
  properties: NotionDataSourceProperties;
  propertyNames: NotionPropertyNames;
  customRules: readonly NotionCustomPropertyRule[];
  locale?: DirongLocale;
}): NotionSchemaDiff {
  const locale = input.locale ?? "ko";
  const actualProperties = listActualProperties(input.properties);
  const actualByName = new Map(actualProperties.map((item) => [item.name, item]));
  const actualByNormalizedName = new Map(
    actualProperties.map((item) => [normalizePropertyNameKey(item.name), item]),
  );
  const desired = buildDesiredProperties({
    propertyNames: input.propertyNames,
    customRules: input.customRules,
  });
  const desiredNameKeys = new Set(
    desired.map((item) => normalizePropertyNameKey(item.name)),
  );
  const consumedActualNames = new Set<string>();
  const missing: NotionSchemaMissingProperty[] = [];
  const renames: NotionSchemaRename[] = [];
  const wrongType: NotionSchemaWrongType[] = [];
  const missingOptions: NotionSchemaMissingOptions[] = [];
  const warnings: string[] = [];

  for (const desiredProperty of desired) {
    const exact = actualByName.get(desiredProperty.name) ?? null;
    let actual = exact;
    if (!actual) {
      actual = findRenameCandidate(desiredProperty, actualProperties, actualByNormalizedName);
      if (actual) {
        renames.push({
          fromName: actual.name,
          toName: desiredProperty.name,
          propertyId: actual.id,
          propertyType: actual.type,
          source: desiredProperty.source,
          requiredKey: desiredProperty.requiredKey,
          relationDataSourceId: desiredProperty.relationDataSourceId,
        });
      }
    }

    if (!actual) {
      missing.push({
        propertyName: desiredProperty.name,
        propertyType: desiredProperty.type,
        source: desiredProperty.source,
        requiredKey: desiredProperty.requiredKey,
        relationDataSourceId: desiredProperty.relationDataSourceId,
      });
      continue;
    }

    consumedActualNames.add(actual.name);
    if (!desiredProperty.accepts.includes(actual.type)) {
      wrongType.push({
        propertyName: actual.name,
        propertyId: actual.id,
        expectedType: desiredProperty.accepts.join(" or "),
        expectedManagedType: desiredProperty.type,
        optionNames: desiredProperty.optionNames,
        relationDataSourceId: desiredProperty.relationDataSourceId,
        actualType: actual.type,
        canUpdate: canUpdatePropertyType(actual.type, desiredProperty.type),
        source: desiredProperty.source,
        requiredKey: desiredProperty.requiredKey,
      });
      continue;
    }

    if (
      desiredProperty.type === "relation" &&
      actual.type === "relation" &&
      desiredProperty.relationDataSourceId &&
      readRelationDataSourceId(actual.property) !== desiredProperty.relationDataSourceId
    ) {
      wrongType.push({
        propertyName: actual.name,
        propertyId: actual.id,
        expectedType: `relation:${desiredProperty.relationDataSourceId}`,
        expectedManagedType: desiredProperty.type,
        optionNames: [],
        relationDataSourceId: desiredProperty.relationDataSourceId,
        actualType: `relation:${readRelationDataSourceId(actual.property) ?? "unknown"}`,
        canUpdate: true,
        source: desiredProperty.source,
        requiredKey: desiredProperty.requiredKey,
      });
      continue;
    }

    if (
      desiredProperty.optionNames.length > 0 &&
      (actual.type === "select" || actual.type === "status")
    ) {
      const optionNames = readOptionNames(actual.property, actual.type);
      const missingOptionNames = desiredProperty.optionNames.filter(
        (optionName) => !optionNames.has(optionName),
      );
      if (missingOptionNames.length > 0) {
        missingOptions.push({
          propertyName: actual.name,
          propertyId: actual.id,
          propertyType: actual.type,
          missingOptions: missingOptionNames,
          existingOptions: readExistingOptionRefs(actual),
          canUpdate: actual.type === "select",
          source: desiredProperty.source,
          requiredKey: desiredProperty.requiredKey,
        });
      }
    }
  }

  const extra = actualProperties
    .filter((actual) => !consumedActualNames.has(actual.name))
    .filter((actual) => !desiredNameKeys.has(normalizePropertyNameKey(actual.name)))
    .map((actual) => ({
      propertyName: actual.name,
      propertyId: actual.id,
      propertyType: actual.type,
      canDelete: actual.type !== "title",
    }));

  if (missing.some((item) => item.propertyType === "title")) {
    warnings.push(t(locale, "notionDashboardService.schemaManager.titleCreateWarning"));
  }
  for (const item of missingOptions.filter((entry) => !entry.canUpdate)) {
    warnings.push(formatLocaleText(
      locale,
      "notionDashboardService.schemaManager.immutableOptionManual",
      {
        propertyName: item.propertyName,
        propertyType: item.propertyType,
      },
    ));
  }

  return {
    desired,
    missing,
    renames,
    wrongType,
    missingOptions,
    extra,
    isCompatible:
      renames.length === 0 &&
      missing.length === 0 &&
      wrongType.length === 0 &&
      missingOptions.every((item) => item.canUpdate || item.missingOptions.length === 0),
    warnings,
  };
}

export function buildNotionSchemaUpdatePlan(
  diff: NotionSchemaDiff,
  options: NotionSchemaApplyOptions,
  locale: DirongLocale = "ko",
): NotionSchemaUpdatePlan {
  const properties: Record<string, unknown> = {};
  const operations = {
    create: 0,
    rename: 0,
    updateType: 0,
    updateOptions: 0,
    delete: 0,
  };
  const warnings = [...diff.warnings];
  const blocked: string[] = [];

  for (const rename of diff.renames) {
    mergePropertyUpdate(properties, propertyPatchKey(rename.fromName, rename.propertyId), {
      name: rename.toName,
    });
    operations.rename += 1;
  }

  if (options.createMissing) {
    for (const missing of diff.missing) {
      if (missing.propertyType === "title") {
        blocked.push(formatLocaleText(
          locale,
          "notionDashboardService.schemaManager.titleCreateBlocked",
          { propertyName: missing.propertyName },
        ));
        continue;
      }
      if (missing.propertyType === "relation" && !missing.relationDataSourceId) {
        blocked.push(formatLocaleText(
          locale,
          "notionDashboardService.schemaManager.relationTargetRequired",
          { propertyName: missing.propertyName },
        ));
        continue;
      }
      properties[missing.propertyName] = schemaForManagedProperty(missing);
      operations.create += 1;
    }
  } else if (diff.missing.length > 0) {
    warnings.push(t(
      locale,
      "notionDashboardService.schemaManager.createMissingDisabled",
    ));
  }

  if (options.updateTypes) {
    for (const item of diff.wrongType) {
      if (!item.canUpdate) {
        blocked.push(formatLocaleText(
          locale,
          "notionDashboardService.schemaManager.typeChangeUnsupported",
          {
            propertyName: item.propertyName,
            actualType: item.actualType,
            expectedType: item.expectedType,
          },
        ));
        continue;
      }
      if (item.expectedManagedType === "relation" && !item.relationDataSourceId) {
        blocked.push(formatLocaleText(
          locale,
          "notionDashboardService.schemaManager.relationTargetRequired",
          { propertyName: item.propertyName },
        ));
        continue;
      }
      mergePropertyUpdate(
        properties,
        propertyPatchKey(item.propertyName, item.propertyId),
        schemaForType(item.expectedManagedType, {
          optionNames: item.optionNames,
          relationDataSourceId: item.relationDataSourceId,
        }),
      );
      operations.updateType += 1;
    }
  } else if (diff.wrongType.length > 0) {
    warnings.push(t(locale, "notionDashboardService.schemaManager.typeUpdateDisabled"));
  }

  for (const item of diff.missingOptions) {
    if (!item.canUpdate) {
      blocked.push(formatLocaleText(
        locale,
        "notionDashboardService.schemaManager.statusOptionManual",
        {
          propertyName: item.propertyName,
          options: item.missingOptions.join(", "),
        },
      ));
      continue;
    }
    mergePropertyUpdate(
      properties,
      propertyPatchKey(item.propertyName, item.propertyId),
      {
        select: {
          options: [
            ...item.existingOptions,
            ...item.missingOptions.map(statusOptionSchema),
          ],
        },
      },
    );
    operations.updateOptions += 1;
  }

  if (options.deleteExtra) {
    if (!options.confirmDeleteExtra) {
      warnings.push(t(locale, "notionDashboardService.schemaManager.deleteExtraSkipped"));
    } else {
      for (const item of diff.extra) {
        if (!item.canDelete) {
          blocked.push(formatLocaleText(
            locale,
            "notionDashboardService.schemaManager.titleDeleteBlocked",
            { propertyName: item.propertyName },
          ));
          continue;
        }
        properties[propertyPatchKey(item.propertyName, item.propertyId)] = null;
        operations.delete += 1;
      }
    }
  }

  return {
    body: Object.keys(properties).length > 0 ? { properties } : null,
    operations,
    warnings,
    blocked,
  };
}

function buildDesiredProperties(input: {
  propertyNames: NotionPropertyNames;
  customRules: readonly NotionCustomPropertyRule[];
}): NotionSchemaDesiredProperty[] {
  const desired: NotionSchemaDesiredProperty[] = [];
  const seen = new Set<string>();

  for (const requirement of REQUIRED_PROPERTY_REQUIREMENTS) {
    const name = cleanInline(input.propertyNames[requirement.key]);
    if (!name) {
      continue;
    }
    desired.push({
      name,
      type: requirement.type,
      accepts: requirement.accepts,
      source: "required",
      requiredKey: requirement.key,
      optionNames: requirement.optionNames ?? [],
      relationDataSourceId: null,
    });
    seen.add(normalizePropertyNameKey(name));
  }

  for (const rule of input.customRules) {
    const name = cleanInline(rule.propertyName);
    if (!name || seen.has(normalizePropertyNameKey(name))) {
      continue;
    }
    if (!isSupportedCustomPropertyType(rule.propertyType)) {
      continue;
    }
    desired.push({
      name,
      type: customTypeToManagedType(rule.propertyType),
      accepts: [rule.propertyType],
      source: "custom",
      requiredKey: null,
      optionNames: [],
      relationDataSourceId:
        rule.propertyType === "relation" ? rule.relationDataSourceId : null,
    });
    seen.add(normalizePropertyNameKey(name));
  }

  return desired;
}

function listActualProperties(
  properties: NotionDataSourceProperties,
): NotionSchemaActualProperty[] {
  return Object.entries(properties).map(([key, property]) => ({
    name: cleanInline(property.name ?? key) || key,
    key,
    id: typeof property.id === "string" ? property.id : null,
    type: cleanInline(property.type ?? "unknown") || "unknown",
    property,
  }));
}

function findRenameCandidate(
  desired: NotionSchemaDesiredProperty,
  actualProperties: readonly NotionSchemaActualProperty[],
  actualByNormalizedName: ReadonlyMap<string, NotionSchemaActualProperty>,
): NotionSchemaActualProperty | null {
  if (desired.type === "title") {
    return actualProperties.find((actual) => actual.type === "title") ?? null;
  }
  return actualByNormalizedName.get(normalizePropertyNameKey(desired.name)) ?? null;
}

function canUpdatePropertyType(
  actualType: string,
  desiredType: NotionSchemaManagedType,
): boolean {
  return !IMMUTABLE_API_TYPES.has(actualType) && desiredType !== "title";
}

function schemaForManagedProperty(
  property: NotionSchemaMissingProperty,
): Record<string, unknown> {
  return schemaForType(
    property.propertyType,
    {
      optionNames: property.requiredKey === "status" ? NOTION_PAGE_STATUS_VALUES : [],
      relationDataSourceId: property.relationDataSourceId,
    },
  );
}

function schemaForType(
  type: NotionSchemaManagedType,
  config: {
    optionNames: readonly string[];
    relationDataSourceId: string | null;
  },
): Record<string, unknown> {
  if (type === "title") {
    return { title: {} };
  }
  if (type === "rich_text") {
    return { rich_text: {} };
  }
  if (type === "date") {
    return { date: {} };
  }
  if (type === "multi_select") {
    return { multi_select: { options: [] } };
  }
  if (type === "checkbox") {
    return { checkbox: {} };
  }
  if (type === "relation") {
    return { relation: { data_source_id: config.relationDataSourceId } };
  }
  return {
    select: {
      options: config.optionNames.map(statusOptionSchema),
    },
  };
}

function readExistingOptionRefs(
  actual: NotionSchemaActualProperty | null,
): Array<Record<string, string>> {
  if (!actual || (actual.type !== "select" && actual.type !== "status")) {
    return [];
  }
  return readPropertyExistingOptionRefs(actual.property, actual.type);
}

function readOptionNames(
  property: NotionDataSourceProperty,
  type: "select" | "status",
): Set<string> {
  return readPropertyOptionNames(property, type);
}

function mergePropertyUpdate(
  properties: Record<string, unknown>,
  key: string,
  update: Record<string, unknown>,
): void {
  const existing = properties[key];
  properties[key] = isRecord(existing)
    ? { ...existing, ...update }
    : update;
}

function propertyPatchKey(name: string, propertyId: string | null): string {
  return propertyId ?? name;
}

function customTypeToManagedType(
  type: NotionCustomPropertyType,
): NotionSchemaManagedType {
  return type;
}

function cleanInline(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizePropertyNameKey(value: string): string {
  return value.trim().toLocaleLowerCase("ko-KR");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
