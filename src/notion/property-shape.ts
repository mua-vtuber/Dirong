import { NOTION_PAGE_STATUS_VALUES, type NotionPageStatus } from "./page-properties.js";
import type { NotionDataSourceProperty } from "./schema.js";
import { isRecord } from "./data-source-readers.js";

export type NotionOptionPropertyType = "select" | "status" | "multi_select";

const STATUS_SELECT_OPTIONS: Record<NotionPageStatus, { name: string; color: string }> = {
  draft: { name: "draft", color: "gray" },
  done: { name: "done", color: "green" },
  retry_wait: { name: "retry_wait", color: "yellow" },
  failed: { name: "failed", color: "red" },
};

export function readPropertyOptionNames(
  property: NotionDataSourceProperty,
  type: NotionOptionPropertyType,
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

export function readExistingOptionRefs(
  property: NotionDataSourceProperty,
  type: NotionOptionPropertyType,
): Array<Record<string, string>> {
  const config = property[type];
  if (!isRecord(config) || !Array.isArray(config.options)) {
    return [];
  }
  const refs: Array<Record<string, string>> = [];
  for (const option of config.options) {
    if (!isRecord(option)) {
      continue;
    }
    if (typeof option.id === "string") {
      refs.push({ id: option.id });
      continue;
    }
    if (typeof option.name === "string") {
      refs.push(
        typeof option.color === "string"
          ? { name: option.name, color: option.color }
          : { name: option.name },
      );
    }
  }
  return refs;
}

export function readRelationDataSourceId(
  property: NotionDataSourceProperty,
): string | null {
  const relation = property.relation;
  return isRecord(relation) && typeof relation.data_source_id === "string"
    ? relation.data_source_id
    : null;
}

export function statusOptionSchema(optionName: string): { name: string; color: string } {
  if (isNotionPageStatus(optionName)) {
    return STATUS_SELECT_OPTIONS[optionName];
  }
  return { name: optionName, color: "default" };
}

export function managedSelectOptionSchema(name: string): { name: string; color: string } {
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

function isNotionPageStatus(value: string): value is NotionPageStatus {
  return NOTION_PAGE_STATUS_VALUES.includes(value as NotionPageStatus);
}
