import type { NotionPropertyNames } from "./settings.js";
import { formatLocaleText, t } from "../i18n/catalog.js";
import type { DirongLocale } from "../settings/local-settings-store.js";
import { NOTION_PAGE_STATUS_VALUES } from "./page-properties.js";
import { readPropertyOptionNames } from "./property-shape.js";
import type {
  NotionDatabaseRole,
  NotionPropertySemanticKey,
  NotionSchemaPresetPropertyType,
} from "./schema-presets.js";

export type NotionPropertyNameKey = keyof NotionPropertyNames;

export type NotionDataSourceProperty = {
  id?: string;
  name?: string;
  type?: string;
  [key: string]: unknown;
};

export type NotionDataSourceProperties = Record<
  string,
  NotionDataSourceProperty
>;

export type NotionResolvedProperty = {
  id: string;
  name: string;
  type: string;
};

export type NotionResolvedPropertyIds = Record<
  NotionPropertyNameKey,
  NotionResolvedProperty
>;

export type NotionSchemaWrongType = {
  property: string;
  expected: string;
  actual: string;
};

export type NotionSchemaMissingOption = {
  property: string;
  type: string;
  missingOptions: string[];
};

export type NotionSchemaValidation =
  | { ok: true; propertyIds: NotionResolvedPropertyIds }
  | {
      ok: false;
      missing: string[];
      wrongType: NotionSchemaWrongType[];
      missingOptions: NotionSchemaMissingOption[];
      userAction: string;
    };

export type NotionSemanticResolvedProperty = NotionResolvedProperty & {
  semanticKey: NotionPropertySemanticKey;
};

export type NotionSemanticResolvedProperties = Partial<
  Record<NotionPropertySemanticKey, NotionSemanticResolvedProperty>
>;

export type NotionSemanticPropertyMappingInput = {
  semanticKey: NotionPropertySemanticKey;
  propertyName: string;
  propertyId: string | null;
  propertyType: NotionSchemaPresetPropertyType;
};

export type NotionSemanticSchemaMissing = {
  semanticKey: NotionPropertySemanticKey;
  property: string;
};

export type NotionSemanticSchemaWrongType = {
  semanticKey: NotionPropertySemanticKey;
  property: string;
  expected: string;
  actual: string;
};

export type NotionSemanticSchemaValidation =
  | { ok: true; propertyIds: NotionSemanticResolvedProperties }
  | {
      ok: false;
      missing: NotionSemanticSchemaMissing[];
      wrongType: NotionSemanticSchemaWrongType[];
      missingOptions: NotionSchemaMissingOption[];
      userAction: string;
    };

type PropertyRequirement = {
  key: NotionPropertyNameKey;
  expected: string;
  accepts: readonly string[];
};

const PROPERTY_REQUIREMENTS: readonly PropertyRequirement[] = [
  { key: "title", expected: "title", accepts: ["title"] },
  { key: "date", expected: "date", accepts: ["date"] },
  { key: "meetingTime", expected: "rich_text", accepts: ["rich_text"] },
  { key: "channel", expected: "rich_text", accepts: ["rich_text"] },
  {
    key: "participants",
    expected: "multi_select or rollup",
    accepts: ["multi_select", "rollup"],
  },
  { key: "status", expected: "select or status", accepts: ["select", "status"] },
  { key: "sessionId", expected: "rich_text", accepts: ["rich_text"] },
  { key: "draftId", expected: "rich_text", accepts: ["rich_text"] },
  { key: "contentHash", expected: "rich_text", accepts: ["rich_text"] },
  { key: "localStatus", expected: "rich_text", accepts: ["rich_text"] },
];

export function validateNotionDataSourceSchema(
  properties: NotionDataSourceProperties,
  propertyNames: NotionPropertyNames,
  locale: DirongLocale = "ko",
): NotionSchemaValidation {
  const missing: string[] = [];
  const wrongType: NotionSchemaWrongType[] = [];
  const resolved = {} as Partial<NotionResolvedPropertyIds>;

  for (const requirement of PROPERTY_REQUIREMENTS) {
    const name = propertyNames[requirement.key];
    const property = properties[name];

    if (!property) {
      missing.push(name);
      continue;
    }

    const actual = property.type ?? "unknown";
    if (!requirement.accepts.includes(actual)) {
      wrongType.push({
        property: name,
        expected: requirement.expected,
        actual,
      });
      continue;
    }

    if (requirement.key === "status" && actual === "status") {
      const missingOptions = NOTION_PAGE_STATUS_VALUES.filter(
        (option) => !readPropertyOptionNames(property, "status").has(option),
      );
      if (missingOptions.length > 0) {
        wrongType.push({
          property: name,
          expected: `status options: ${NOTION_PAGE_STATUS_VALUES.join(", ")}`,
          actual: `missing options: ${missingOptions.join(", ")}`,
        });
        continue;
      }
    }

    resolved[requirement.key] = {
      id: property.id ?? name,
      name,
      type: actual,
    };
  }

  if (missing.length === 0 && wrongType.length === 0) {
    return { ok: true, propertyIds: resolved as NotionResolvedPropertyIds };
  }

  return {
    ok: false,
    missing,
    wrongType,
    missingOptions: [],
    userAction: buildSchemaUserAction(missing, wrongType, locale),
  };
}

export function validateNotionDataSourceSchemaBySemanticKey(input: {
  databaseRole: NotionDatabaseRole;
  properties: NotionDataSourceProperties;
  mappings: readonly NotionSemanticPropertyMappingInput[];
  requiredSemanticKeys: readonly NotionPropertySemanticKey[];
  locale?: DirongLocale;
}): NotionSemanticSchemaValidation {
  const missing: NotionSemanticSchemaMissing[] = [];
  const wrongType: NotionSemanticSchemaWrongType[] = [];
  const resolved: NotionSemanticResolvedProperties = {};
  const mappingsByKey = new Map(
    input.mappings.map((mapping) => [mapping.semanticKey, mapping]),
  );
  const actualProperties = listActualProperties(input.properties);

  for (const semanticKey of input.requiredSemanticKeys) {
    const requirement = semanticRequirement(semanticKey);
    const mapping = mappingsByKey.get(semanticKey);
    if (!mapping) {
      missing.push({ semanticKey, property: semanticKey });
      continue;
    }

    const actual = findActualProperty(actualProperties, mapping);
    const propertyName = mapping.propertyName;
    if (!actual) {
      missing.push({ semanticKey, property: propertyName });
      continue;
    }

    if (!requirement.accepts.includes(actual.type)) {
      wrongType.push({
        semanticKey,
        property: actual.name,
        expected: requirement.expected,
        actual: actual.type,
      });
      continue;
    }

    if (semanticKey === "meeting.status" && actual.type === "status") {
      const missingOptions = NOTION_PAGE_STATUS_VALUES.filter(
        (option) => !readPropertyOptionNames(actual.property, "status").has(option),
      );
      if (missingOptions.length > 0) {
        wrongType.push({
          semanticKey,
          property: actual.name,
          expected: `status options: ${NOTION_PAGE_STATUS_VALUES.join(", ")}`,
          actual: `missing options: ${missingOptions.join(", ")}`,
        });
        continue;
      }
    }

    resolved[semanticKey] = {
      semanticKey,
      id: actual.id ?? actual.name,
      name: actual.name,
      type: actual.type,
    };
  }

  if (missing.length === 0 && wrongType.length === 0) {
    return { ok: true, propertyIds: resolved };
  }

  return {
    ok: false,
    missing,
    wrongType,
    missingOptions: [],
    userAction: buildSemanticSchemaUserAction(
      missing,
      wrongType,
      input.locale ?? "ko",
    ),
  };
}

function semanticRequirement(semanticKey: NotionPropertySemanticKey): {
  expected: string;
  accepts: readonly string[];
} {
  if (semanticKey === "meeting.title" || semanticKey === "member.discordName") {
    return { expected: "title", accepts: ["title"] };
  }
  if (
    semanticKey === "meeting.date" ||
    semanticKey === "task.dueDate"
  ) {
    return { expected: "date", accepts: ["date"] };
  }
  if (
    semanticKey === "meeting.time" ||
    semanticKey === "meeting.channel" ||
    semanticKey === "meeting.sessionId" ||
    semanticKey === "meeting.draftId" ||
    semanticKey === "meeting.contentHash" ||
    semanticKey === "meeting.localStatus" ||
    semanticKey === "task.evidence" ||
    semanticKey === "task.sourceActionId"
  ) {
    return { expected: "rich_text", accepts: ["rich_text"] };
  }
  if (
    semanticKey === "meeting.memberRelation" ||
    semanticKey === "meeting.actionItems" ||
    semanticKey === "task.meeting" ||
    semanticKey === "task.workerRelation"
  ) {
    return { expected: "relation", accepts: ["relation"] };
  }
  if (
    semanticKey === "meeting.participants" ||
    semanticKey === "task.assignee" ||
    semanticKey === "task.role"
  ) {
    return { expected: "rollup", accepts: ["rollup"] };
  }
  if (semanticKey === "meeting.status" || semanticKey === "task.status") {
    return { expected: "select or status", accepts: ["select", "status"] };
  }
  if (semanticKey === "member.notionPerson") {
    return { expected: "people", accepts: ["people"] };
  }
  if (semanticKey === "member.organization") {
    return { expected: "select", accepts: ["select"] };
  }
  if (semanticKey === "member.roles") {
    return { expected: "multi_select", accepts: ["multi_select"] };
  }
  return { expected: "mapped type", accepts: [] };
}

function listActualProperties(
  properties: NotionDataSourceProperties,
): Array<{
  key: string;
  id: string | null;
  name: string;
  type: string;
  property: NotionDataSourceProperty;
}> {
  return Object.entries(properties).map(([key, property]) => ({
    key,
    id: typeof property.id === "string" ? property.id : null,
    name: cleanInline(property.name ?? key) || key,
    type: cleanInline(property.type ?? "unknown") || "unknown",
    property,
  }));
}

function findActualProperty(
  actualProperties: ReturnType<typeof listActualProperties>,
  mapping: NotionSemanticPropertyMappingInput,
): ReturnType<typeof listActualProperties>[number] | null {
  if (mapping.propertyId) {
    const byId = actualProperties.find((property) => property.id === mapping.propertyId);
    if (byId) {
      return byId;
    }
  }

  return (
    actualProperties.find(
      (property) =>
        property.key === mapping.propertyName ||
        property.name === mapping.propertyName,
    ) ?? null
  );
}

function buildSchemaUserAction(
  missing: string[],
  wrongType: NotionSchemaWrongType[],
  locale: DirongLocale,
): string {
  const messages: string[] = [];
  if (missing.length > 0) {
    messages.push(
      formatLocaleText(
        locale,
        "notionDashboardService.legacySchemaValidation.missing",
        { items: missing.join(", ") },
      ),
    );
  }
  if (wrongType.length > 0) {
    const items = wrongType
      .map((item) => `${item.property}(${item.actual} -> ${item.expected})`)
      .join(", ");
    messages.push(
      formatLocaleText(
        locale,
        "notionDashboardService.legacySchemaValidation.wrongType",
        { items },
      ),
    );
  }
  messages.push(
    t(locale, "notionDashboardService.legacySchemaValidation.checkAgain"),
  );
  return messages.join(" ");
}

function buildSemanticSchemaUserAction(
  missing: NotionSemanticSchemaMissing[],
  wrongType: NotionSemanticSchemaWrongType[],
  locale: DirongLocale,
): string {
  const messages: string[] = [];
  if (missing.length > 0) {
    const items = missing
      .map((item) => `${item.semanticKey}(${item.property})`)
      .join(", ");
    messages.push(
      formatLocaleText(
        locale,
        "notionDashboardService.legacySchemaValidation.semanticMissing",
        { items },
      ),
    );
  }
  if (wrongType.length > 0) {
    const items = wrongType
      .map(
        (item) =>
          `${item.semanticKey}:${item.property}(${item.actual} -> ${item.expected})`,
      )
      .join(", ");
    messages.push(
      formatLocaleText(
        locale,
        "notionDashboardService.legacySchemaValidation.semanticWrongType",
        { items },
      ),
    );
  }
  messages.push(
    t(locale, "notionDashboardService.legacySchemaValidation.semanticCheckAgain"),
  );
  return messages.join(" ");
}

function cleanInline(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

