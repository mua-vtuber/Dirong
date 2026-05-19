import {
  readManagedNotionRegistrySnapshot,
  type ManagedNotionRegistrySnapshot,
} from "./managed-registry.js";
import { t } from "../i18n/catalog.js";
import type { DirongLocale } from "../settings/local-settings-store.js";
import type { NotionRegistryStore } from "./registry-store.js";

export const MANAGED_NOTION_REGISTRY_INCOMPLETE_MESSAGE =
  "Managed Notion registry is incomplete.";

export const MANAGED_NOTION_REGISTRY_INCOMPLETE_USER_ACTION =
  "Some registry values already exist, so Dirong did not fall back to the legacy target.";

export type ManagedNotionRegistryBlock = {
  snapshot: ManagedNotionRegistrySnapshot;
  message: string;
  userAction: string;
  technicalDetail: string;
};

export function blockPartialManagedNotionRegistry(
  registryStore: NotionRegistryStore | null | undefined,
  options: {
    includeDatabases?: boolean;
    projectId?: string | null;
    locale?: DirongLocale;
  } = {},
): ManagedNotionRegistryBlock | null {
  const snapshot = readManagedNotionRegistrySnapshot(registryStore, {
    projectId: options.projectId,
  });
  if (snapshot.status !== "partial") {
    return null;
  }
  return {
    snapshot,
    message: MANAGED_NOTION_REGISTRY_INCOMPLETE_MESSAGE,
    userAction: t(
      options.locale ?? "ko",
      "notionDashboardService.uploadTarget.partialRegistryAction",
    ),
    technicalDetail: JSON.stringify(managedRegistryDetail(snapshot, options)),
  };
}

export function hasCompleteManagedNotionUploadRegistry(
  registryStore: NotionRegistryStore | null | undefined,
  options: { projectId?: string | null } = {},
): boolean {
  return readManagedNotionRegistrySnapshot(registryStore, {
    projectId: options.projectId,
  }).status === "ready";
}

function managedRegistryDetail(
  snapshot: ManagedNotionRegistrySnapshot,
  options: { includeDatabases?: boolean },
): Record<string, unknown> {
  const detail: Record<string, unknown> = {
    databaseCount: snapshot.databaseCount,
    expectedDatabaseCount: snapshot.expectedDatabaseCount,
    propertyMappingCount: snapshot.propertyMappingCount,
    expectedPropertyMappingCount: snapshot.expectedPropertyMappingCount,
  };
  if (options.includeDatabases) {
    detail.databases = snapshot.databases.map((database) => ({
      role: database.role,
      hasDatabase: database.hasDatabase,
      mappingCount: database.mappingCount,
      expectedMappingCount: database.expectedMappingCount,
      missingSemanticKeys: database.missingSemanticKeys,
    }));
  }
  return detail;
}
