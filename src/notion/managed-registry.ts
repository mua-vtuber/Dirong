import {
  databaseRoleForSemanticKey,
  KOREAN_NOTION_SCHEMA_PRESET,
  NOTION_DATABASE_ROLES,
  NOTION_PROPERTY_SEMANTIC_KEYS,
  type NotionDatabaseRole,
  type NotionLocale,
  type NotionPropertySemanticKey,
} from "./schema-presets.js";
import type {
  ManagedNotionSchemaStatusSnapshot,
} from "./managed-schema-status.js";
import type {
  NotionManagedDatabase,
  NotionPropertyMapping,
  NotionRegistryStore,
  NotionWorkspaceSettings,
} from "./registry-store.js";

export type ManagedNotionRegistryStatus = "missing" | "partial" | "ready";

export type ManagedNotionRegistryDatabaseSnapshot = {
  role: NotionDatabaseRole;
  expectedName: string;
  name: string | null;
  url: string | null;
  locale: NotionLocale | null;
  hasDatabase: boolean;
  createdByDirong: boolean | null;
  schemaVersion: string | null;
  mappingCount: number;
  expectedMappingCount: number;
  missingSemanticKeys: NotionPropertySemanticKey[];
  ready: boolean;
};

export type ManagedNotionRegistrySnapshot = {
  status: ManagedNotionRegistryStatus;
  workspace: {
    locale: NotionLocale;
    parentPageUrl: string;
  } | null;
  databaseCount: number;
  expectedDatabaseCount: number;
  propertyMappingCount: number;
  expectedPropertyMappingCount: number;
  databases: ManagedNotionRegistryDatabaseSnapshot[];
  remoteCheck: ManagedNotionSchemaStatusSnapshot | null;
  actionItemUpload: {
    status: "implemented";
    message: string;
  };
};

export function readManagedNotionRegistrySnapshot(
  registryStore: NotionRegistryStore | null | undefined,
  options: { remoteCheck?: ManagedNotionSchemaStatusSnapshot | null } = {},
): ManagedNotionRegistrySnapshot {
  const workspace = registryStore?.getWorkspaceSettings() ?? null;
  const managedDatabases = registryStore?.listManagedDatabases() ?? [];
  const propertyMappings = registryStore?.listPropertyMappings() ?? [];
  const databases = NOTION_DATABASE_ROLES.map((role) =>
    buildDatabaseSnapshot({
      role,
      managedDatabase: managedDatabases.find((database) => database.role === role) ?? null,
      mappings: propertyMappings.filter((mapping) => mapping.databaseRole === role),
    }),
  );
  const hasAnyRegistryValue = Boolean(
    workspace || managedDatabases.length > 0 || propertyMappings.length > 0,
  );
  const ready = Boolean(workspace) && databases.every((database) => database.ready);

  return {
    status: ready ? "ready" : hasAnyRegistryValue ? "partial" : "missing",
    workspace: workspace ? workspaceToSnapshot(workspace) : null,
    databaseCount: managedDatabases.length,
    expectedDatabaseCount: NOTION_DATABASE_ROLES.length,
    propertyMappingCount: propertyMappings.length,
    expectedPropertyMappingCount: NOTION_PROPERTY_SEMANTIC_KEYS.length,
    databases,
    remoteCheck: options.remoteCheck ?? null,
    actionItemUpload: {
      status: "implemented",
      message: "액션 아이템 DB가 준비되면 업로드 시 작업 page를 생성하거나 갱신합니다.",
    },
  };
}

export function hasReadyManagedNotionRegistry(
  registryStore: NotionRegistryStore | null | undefined,
): boolean {
  return readManagedNotionRegistrySnapshot(registryStore).status === "ready";
}

function buildDatabaseSnapshot(input: {
  role: NotionDatabaseRole;
  managedDatabase: NotionManagedDatabase | null;
  mappings: NotionPropertyMapping[];
}): ManagedNotionRegistryDatabaseSnapshot {
  const requiredSemanticKeys = requiredSemanticKeysForRole(input.role);
  const mappedKeys = new Set(input.mappings.map((mapping) => mapping.semanticKey));
  const missingSemanticKeys = requiredSemanticKeys.filter(
    (semanticKey) => !mappedKeys.has(semanticKey),
  );

  return {
    role: input.role,
    expectedName: KOREAN_NOTION_SCHEMA_PRESET.databases[input.role].name,
    name: input.managedDatabase?.name ?? null,
    url: input.managedDatabase?.url ?? null,
    locale: input.managedDatabase?.locale ?? null,
    hasDatabase: Boolean(input.managedDatabase),
    createdByDirong: input.managedDatabase?.createdByDirong ?? null,
    schemaVersion: input.managedDatabase?.schemaVersion ?? null,
    mappingCount: input.mappings.length,
    expectedMappingCount: requiredSemanticKeys.length,
    missingSemanticKeys,
    ready: Boolean(input.managedDatabase) && missingSemanticKeys.length === 0,
  };
}

function requiredSemanticKeysForRole(
  role: NotionDatabaseRole,
): NotionPropertySemanticKey[] {
  return NOTION_PROPERTY_SEMANTIC_KEYS.filter(
    (semanticKey) => databaseRoleForSemanticKey(semanticKey) === role,
  );
}

function workspaceToSnapshot(
  workspace: NotionWorkspaceSettings,
): ManagedNotionRegistrySnapshot["workspace"] {
  return {
    locale: workspace.locale,
    parentPageUrl: workspace.parentPageUrl,
  };
}
