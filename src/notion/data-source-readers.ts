import type { JsonObject, NotionDatabaseResponse } from "./client.js";
import type { NotionDataSourceProperties } from "./schema.js";

export function readDataSourceProperties(
  dataSource: Record<string, unknown>,
): NotionDataSourceProperties {
  const properties = dataSource.properties;
  return isRecord(properties) ? properties as NotionDataSourceProperties : {};
}

export function readDataSourcePropertyMap(
  dataSource: Record<string, unknown>,
): Map<string, JsonObject> {
  const rawProperties = dataSource.properties;
  if (!isRecord(rawProperties)) {
    throw new Error("Notion data source response does not include properties.");
  }

  const properties = new Map<string, JsonObject>();
  for (const [fallbackName, value] of Object.entries(rawProperties)) {
    if (!isRecord(value)) {
      continue;
    }
    const name = readOptionalString(value, "name") ?? fallbackName;
    properties.set(name, value);
  }
  return properties;
}

export function readDataSources(database: Record<string, unknown>): unknown[] {
  return Array.isArray(database.data_sources) ? database.data_sources : [];
}

export function readRichTextPlainText(parts: readonly unknown[]): string {
  return parts
    .map((part) =>
      isRecord(part) && typeof part.plain_text === "string"
        ? part.plain_text
        : isRecord(part) &&
            isRecord(part.text) &&
            typeof part.text.content === "string"
          ? part.text.content
          : "",
    )
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

export function readTargetName(
  dataSource: Record<string, unknown>,
  fallback = "Notion data source",
): string {
  if (typeof dataSource.name === "string" && dataSource.name.trim()) {
    return dataSource.name.trim();
  }
  if (Array.isArray(dataSource.title)) {
    const title = readRichTextPlainText(dataSource.title);
    if (title) {
      return title;
    }
  }
  return fallback;
}

export function readFirstDataSourceId(
  response: NotionDatabaseResponse,
): string | null {
  for (const item of readDataSources(response)) {
    const id = readId(item);
    if (id) {
      return id;
    }
  }
  return null;
}

export function readResults(response: unknown): unknown[] {
  return isRecord(response) && Array.isArray(response.results)
    ? response.results
    : [];
}

export function readId(value: unknown): string | null {
  return isRecord(value) && typeof value.id === "string" ? value.id : null;
}

function readOptionalString(value: JsonObject, key: string): string | null {
  const raw = value[key];
  return typeof raw === "string" && raw.trim() ? raw : null;
}

export function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
