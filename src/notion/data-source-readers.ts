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
    throw new Error("Notion data source 응답에 properties가 없습니다.");
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

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
