import type { NotionClient } from "./client.js";
import {
  readDataSourceProperties,
  readId,
  readResults,
} from "./data-source-readers.js";
import { validateManagedDataSourceSchemaForUpload } from "./managed-schema-diff.js";
import type {
  NotionMemberRosterEntryInput,
  NotionMemberRosterStore,
} from "./member-roster-store.js";
import { normalizeMemberRosterText } from "./member-roster-store.js";
import type {
  NotionManagedDatabase,
  NotionPropertyMapping,
  NotionRegistryStore,
} from "./registry-store.js";
import type { NotionSemanticResolvedProperty } from "./schema.js";
import type { NotionPropertySemanticKey } from "./schema-presets.js";

export type NotionMemberRosterWarningCode =
  | "emptyDiscordName"
  | "duplicateDiscordName"
  | "missingRolesProperty"
  | "missingOrganizationProperty"
  | "unsupportedPropertyType";

export type NotionMemberRosterSyncWarning = {
  code: NotionMemberRosterWarningCode;
  params: Record<string, string | number>;
};

export type NotionMemberRosterSyncResult = {
  ok: boolean;
  status: "done" | "not_configured" | "blocked" | "failed";
  messageKey: string;
  userActionKey: string | null;
  dataSourceId: string | null;
  syncedAt: string | null;
  memberCount: number;
  roleCount: number;
  warnings: NotionMemberRosterSyncWarning[];
};

const MEMBER_ROSTER_REQUIRED_SEMANTIC_KEYS = [
  "member.discordName",
] as const satisfies readonly NotionPropertySemanticKey[];

export async function syncNotionMemberRoster(input: {
  client: NotionClient;
  registryStore: NotionRegistryStore;
  rosterStore: NotionMemberRosterStore;
  nowIso?: string;
}): Promise<NotionMemberRosterSyncResult> {
  const nowIso = input.nowIso ?? new Date().toISOString();
  const memberDatabase = input.registryStore.getManagedDatabase("member");
  if (!memberDatabase) {
    return memberRosterResult({
      ok: false,
      status: "not_configured",
      messageKey: "dashboard.db.memberRoster.status.notConfigured",
      userActionKey: "dashboard.db.memberRoster.action.checkMemberDb",
      dataSourceId: null,
    });
  }

  const dataSource = await input.client.retrieveDataSource(
    memberDatabase.dataSourceId,
  );
  const properties = readDataSourceProperties(dataSource);
  const mappings = input.registryStore.listPropertyMappings();
  const managedDatabases = input.registryStore.listManagedDatabases();
  const requiredValidation = validateManagedDataSourceSchemaForUpload({
    databaseRole: "member",
    properties,
    mappings,
    managedDatabases,
    requiredSemanticKeys: MEMBER_ROSTER_REQUIRED_SEMANTIC_KEYS,
  });
  if (!requiredValidation.ok) {
    input.rosterStore.recordSyncSnapshot({
      dataSourceId: memberDatabase.dataSourceId,
      status: "blocked",
      memberCount: 0,
      warningCount: 0,
      lastError: requiredValidation.userAction,
      nowIso,
    });
    return memberRosterResult({
      ok: false,
      status: "blocked",
      messageKey: "dashboard.db.memberRoster.status.blocked",
      userActionKey: "dashboard.db.memberRoster.action.checkMemberDb",
      dataSourceId: memberDatabase.dataSourceId,
    });
  }

  const warnings: NotionMemberRosterSyncWarning[] = [];
  const discordNameProperty = requireResolvedProperty(
    requiredValidation.propertyIds,
    "member.discordName",
  );
  const organizationProperty = resolveMappedProperty({
    semanticKey: "member.organization",
    properties,
    mappings,
  });
  const rolesProperty = resolveMappedProperty({
    semanticKey: "member.roles",
    properties,
    mappings,
  });

  if (!organizationProperty) {
    warnings.push({
      code: "missingOrganizationProperty",
      params: { semanticKey: "member.organization" },
    });
  }
  if (!rolesProperty) {
    warnings.push({
      code: "missingRolesProperty",
      params: { semanticKey: "member.roles" },
    });
  }

  const pages = await queryAllDataSourcePages(
    input.client,
    memberDatabase.dataSourceId,
  );
  const entries: NotionMemberRosterEntryInput[] = [];
  const duplicateTracker = new Map<string, { display: string; count: number }>();

  pages.forEach((page, index) => {
    const rowNumber = index + 1;
    const pageId = readId(page) ?? `row-${rowNumber}`;
    const discordName = readSinglePageText({
      page,
      property: discordNameProperty,
      semanticKey: "member.discordName",
      warnings,
      rowNumber,
    });
    if (!discordName) {
      warnings.push({
        code: "emptyDiscordName",
        params: { rowNumber },
      });
      return;
    }

    const normalizedDiscordName = normalizeMemberRosterText(discordName);
    const duplicate = duplicateTracker.get(normalizedDiscordName);
    if (duplicate) {
      duplicate.count += 1;
    } else {
      duplicateTracker.set(normalizedDiscordName, {
        display: discordName,
        count: 1,
      });
    }

    const organization = organizationProperty
      ? readSinglePageText({
          page,
          property: organizationProperty,
          semanticKey: "member.organization",
          warnings,
          rowNumber,
        })
      : null;
    const roles = rolesProperty
      ? readMultiPageText({
          page,
          property: rolesProperty,
          semanticKey: "member.roles",
          warnings,
          rowNumber,
        })
      : [];

    entries.push({
      pageId,
      discordName,
      organization,
      roles,
      rawUpdatedAt: readLastEditedTime(page),
    });
  });

  for (const duplicate of duplicateTracker.values()) {
    if (duplicate.count <= 1) {
      continue;
    }
    warnings.push({
      code: "duplicateDiscordName",
      params: {
        discordName: duplicate.display,
        count: duplicate.count,
      },
    });
  }

  input.rosterStore.replaceForDataSource({
    dataSourceId: memberDatabase.dataSourceId,
    entries,
    syncedAt: nowIso,
    warningCount: warnings.length,
    warnings,
  });

  return memberRosterResult({
    ok: true,
    status: "done",
    messageKey: "dashboard.db.memberRoster.status.done",
    userActionKey: null,
    dataSourceId: memberDatabase.dataSourceId,
    syncedAt: nowIso,
    memberCount: entries.length,
    roleCount: countDistinctRoles(entries),
    warnings,
  });
}

function memberRosterResult(
  input: Partial<NotionMemberRosterSyncResult> & {
    ok: boolean;
    status: NotionMemberRosterSyncResult["status"];
    messageKey: string;
    userActionKey: string | null;
    dataSourceId: string | null;
  },
): NotionMemberRosterSyncResult {
  return {
    syncedAt: null,
    memberCount: 0,
    roleCount: 0,
    warnings: [],
    ...input,
  };
}

async function queryAllDataSourcePages(
  client: NotionClient,
  dataSourceId: string,
): Promise<unknown[]> {
  const pages: unknown[] = [];
  let cursor: string | null = null;
  do {
    const body: Record<string, unknown> = { page_size: 100 };
    if (cursor) {
      body.start_cursor = cursor;
    }
    const response = await client.queryDataSource(dataSourceId, body);
    pages.push(...readResults(response));
    cursor = readHasMore(response) ? readNextCursor(response) : null;
  } while (cursor);
  return pages;
}

function resolveMappedProperty(input: {
  semanticKey: NotionPropertySemanticKey;
  properties: Record<string, Record<string, unknown>>;
  mappings: readonly NotionPropertyMapping[];
}): NotionSemanticResolvedProperty | null {
  const mapping =
    input.mappings.find(
      (item) =>
        item.databaseRole === "member" &&
        item.semanticKey === input.semanticKey,
    ) ?? null;
  if (!mapping) {
    return null;
  }

  for (const [fallbackName, property] of Object.entries(input.properties)) {
    const propertyId = typeof property.id === "string" ? property.id : null;
    const propertyName =
      typeof property.name === "string" && property.name.trim()
        ? property.name.trim()
        : fallbackName;
    if (
      (mapping.propertyId && propertyId === mapping.propertyId) ||
      propertyName === mapping.propertyName ||
      fallbackName === mapping.propertyName
    ) {
      return {
        semanticKey: input.semanticKey,
        id: propertyId ?? propertyName,
        name: propertyName,
        type: typeof property.type === "string" ? property.type : mapping.propertyType,
      };
    }
  }

  return null;
}

function requireResolvedProperty(
  properties: Record<string, NotionSemanticResolvedProperty | undefined>,
  semanticKey: NotionPropertySemanticKey,
): NotionSemanticResolvedProperty {
  const property = properties[semanticKey];
  if (!property) {
    throw new Error(`Managed Notion mapping is missing: ${semanticKey}`);
  }
  return property;
}

function readSinglePageText(input: {
  page: unknown;
  property: NotionSemanticResolvedProperty;
  semanticKey: NotionPropertySemanticKey;
  warnings: NotionMemberRosterSyncWarning[];
  rowNumber: number;
}): string | null {
  const values = readPageTextValues(input);
  if (!values) {
    return null;
  }
  return values.join(", ").replace(/\s+/g, " ").trim() || null;
}

function readMultiPageText(input: {
  page: unknown;
  property: NotionSemanticResolvedProperty;
  semanticKey: NotionPropertySemanticKey;
  warnings: NotionMemberRosterSyncWarning[];
  rowNumber: number;
}): string[] {
  return readPageTextValues(input) ?? [];
}

function readPageTextValues(input: {
  page: unknown;
  property: NotionSemanticResolvedProperty;
  semanticKey: NotionPropertySemanticKey;
  warnings: NotionMemberRosterSyncWarning[];
  rowNumber: number;
}): string[] | null {
  const propertyValue = readPageProperty(input.page, input.property.name);
  if (!propertyValue) {
    return [];
  }
  const type = readPropertyValueType(propertyValue) ?? input.property.type;
  if (type === "title") {
    return [readRichTextPlainText(readRecordArray(propertyValue, "title"))]
      .filter((value) => value.length > 0);
  }
  if (type === "rich_text") {
    return [readRichTextPlainText(readRecordArray(propertyValue, "rich_text"))]
      .filter((value) => value.length > 0);
  }
  if (type === "select") {
    const select = readRecord(propertyValue.select);
    const name = typeof select?.name === "string" ? select.name.trim() : "";
    return name ? [name] : [];
  }
  if (type === "multi_select") {
    return readRecordArray(propertyValue, "multi_select")
      .map((option) => typeof option.name === "string" ? option.name.trim() : "")
      .filter((value) => value.length > 0);
  }

  input.warnings.push({
    code: "unsupportedPropertyType",
    params: {
      semanticKey: input.semanticKey,
      propertyType: type || "unknown",
      rowNumber: input.rowNumber,
    },
  });
  return null;
}

function readPageProperty(
  page: unknown,
  propertyName: string,
): Record<string, unknown> | null {
  const pageRecord = readRecord(page);
  const properties = readRecord(pageRecord?.properties);
  const property = properties?.[propertyName];
  return readRecord(property);
}

function readRichTextPlainText(parts: readonly Record<string, unknown>[]): string {
  return parts
    .map((part) => {
      if (typeof part.plain_text === "string") {
        return part.plain_text;
      }
      const text = readRecord(part.text);
      return typeof text?.content === "string" ? text.content : "";
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function readRecordArray(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown>[] {
  const raw = value[key];
  return Array.isArray(raw)
    ? raw.filter((item): item is Record<string, unknown> => readRecord(item) !== null)
    : [];
}

function readPropertyValueType(value: Record<string, unknown>): string | null {
  return typeof value.type === "string" && value.type.trim()
    ? value.type.trim()
    : null;
}

function readLastEditedTime(page: unknown): string | null {
  const record = readRecord(page);
  return typeof record?.last_edited_time === "string"
    ? record.last_edited_time
    : null;
}

function readHasMore(response: unknown): boolean {
  const record = readRecord(response);
  return record?.has_more === true;
}

function readNextCursor(response: unknown): string | null {
  const record = readRecord(response);
  return typeof record?.next_cursor === "string" && record.next_cursor.trim()
    ? record.next_cursor
    : null;
}

function countDistinctRoles(
  entries: readonly NotionMemberRosterEntryInput[],
): number {
  const roles = new Set<string>();
  for (const entry of entries) {
    for (const role of entry.roles ?? []) {
      const normalized = normalizeMemberRosterText(role);
      if (normalized) {
        roles.add(normalized);
      }
    }
  }
  return roles.size;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
