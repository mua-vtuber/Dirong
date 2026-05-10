import type { NotionPropertyNames } from "./settings.js";
import { NOTION_PAGE_STATUS_VALUES } from "./page-properties.js";

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
    userAction: buildSchemaUserAction(missing, wrongType),
  };
}

function readPropertyOptionNames(
  property: NotionDataSourceProperty,
  type: "select" | "status",
): Set<string> {
  const config = property[type];
  if (!isRecord(config) || !Array.isArray(config.options)) {
    return new Set();
  }
  return new Set(
    config.options
      .map((option) =>
        isRecord(option) && typeof option.name === "string"
          ? option.name
          : null,
      )
      .filter((name): name is string => name !== null),
  );
}

function buildSchemaUserAction(
  missing: string[],
  wrongType: NotionSchemaWrongType[],
): string {
  const messages: string[] = [];
  if (missing.length > 0) {
    messages.push(
      `Notion 데이터베이스에 필요한 속성을 추가해 주세요: ${missing.join(", ")}`,
    );
  }
  if (wrongType.length > 0) {
    messages.push(
      `Notion 속성 타입을 확인해 주세요: ${wrongType
        .map((item) => `${item.property}(${item.actual} -> ${item.expected})`)
        .join(", ")}`,
    );
  }
  messages.push("속성을 수정한 뒤 Dirong 연결 테스트를 다시 실행해 주세요.");
  return messages.join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
