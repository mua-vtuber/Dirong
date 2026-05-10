export type ParsedNotionTarget =
  | { kind: "data_source_id"; id: string; url: string | null }
  | { kind: "database_id"; id: string; url: string | null }
  | { kind: "invalid"; reason: string };

export type ParsedNotionPage =
  | { kind: "page_id"; id: string; url: string | null }
  | { kind: "invalid"; reason: string };

const UUID_32_PATTERN = /^[0-9a-f]{32}$/i;
const UUID_DASHED_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMBEDDED_UUID_PATTERN =
  /([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

export function normalizeNotionId(value: string): string | null {
  const trimmed = value.trim();
  const compact = trimmed.replaceAll("-", "");
  if (!UUID_32_PATTERN.test(compact)) {
    return null;
  }
  return [
    compact.slice(0, 8),
    compact.slice(8, 12),
    compact.slice(12, 16),
    compact.slice(16, 20),
    compact.slice(20),
  ].join("-").toLowerCase();
}

export function parseNotionTargetUrl(input: string): ParsedNotionTarget {
  const trimmed = input.trim();
  if (!trimmed) {
    return { kind: "invalid", reason: "empty" };
  }

  const bareId = normalizeNotionId(trimmed);
  if (bareId) {
    return { kind: "data_source_id", id: bareId, url: null };
  }

  const url = parseUrl(trimmed);
  if (!url) {
    return { kind: "invalid", reason: "not_a_notion_id_or_url" };
  }

  const dataSourceId = readDataSourceIdFromUrl(url);
  if (dataSourceId) {
    return { kind: "data_source_id", id: dataSourceId, url: url.href };
  }

  const pathId = readLastNotionIdFromPath(url);
  if (!pathId) {
    return { kind: "invalid", reason: "missing_target_id" };
  }

  if (looksLikeDatabaseUrl(url)) {
    return { kind: "database_id", id: pathId, url: url.href };
  }

  return { kind: "invalid", reason: "page_like_url_not_supported" };
}

export function parseNotionPageUrl(input: string): ParsedNotionPage {
  const trimmed = input.trim();
  if (!trimmed) {
    return { kind: "invalid", reason: "empty" };
  }

  const bareId = normalizeNotionId(trimmed);
  if (bareId) {
    return { kind: "page_id", id: bareId, url: null };
  }

  const url = parseUrl(trimmed);
  if (!url) {
    return { kind: "invalid", reason: "not_a_notion_id_or_url" };
  }

  if (readDataSourceIdFromUrl(url) || looksLikeDatabaseUrl(url)) {
    return { kind: "invalid", reason: "database_like_url_not_supported" };
  }

  const pageId = readLastNotionIdFromPath(url);
  if (!pageId) {
    return { kind: "invalid", reason: "missing_page_id" };
  }

  return { kind: "page_id", id: pageId, url: url.href };
}

function parseUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function readDataSourceIdFromUrl(url: URL): string | null {
  for (const key of ["data_source_id", "data_source", "datasource_id"]) {
    const id = normalizeNotionId(url.searchParams.get(key) ?? "");
    if (id) {
      return id;
    }
  }

  const segments = url.pathname
    .split("/")
    .map((segment) => decodeURIComponent(segment).trim())
    .filter(Boolean);

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]?.toLowerCase();
    if (
      segment !== "data-source" &&
      segment !== "data-sources" &&
      segment !== "data_source" &&
      segment !== "data_sources"
    ) {
      continue;
    }

    const id = normalizeNotionId(segments[index + 1] ?? "");
    if (id) {
      return id;
    }
  }

  return null;
}

function readLastNotionIdFromPath(url: URL): string | null {
  const matches = [...url.pathname.matchAll(EMBEDDED_UUID_PATTERN)];
  const raw = matches.at(-1)?.[1];
  return raw ? normalizeNotionId(raw) : null;
}

function looksLikeDatabaseUrl(url: URL): boolean {
  const lowerPath = url.pathname.toLowerCase();
  if (lowerPath.includes("/database/") || lowerPath.includes("/databases/")) {
    return true;
  }

  return (
    url.searchParams.has("v") ||
    url.searchParams.has("view") ||
    UUID_DASHED_PATTERN.test(url.searchParams.get("view_id") ?? "")
  );
}
