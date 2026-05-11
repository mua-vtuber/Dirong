import {
  hasReadyManagedNotionRegistry,
  readManagedNotionRegistrySnapshot,
  type ManagedNotionRegistrySnapshot,
} from "./managed-registry.js";
import type { NotionRegistryStore } from "./registry-store.js";

export const MANAGED_NOTION_REGISTRY_INCOMPLETE_MESSAGE =
  "Managed Notion registry is incomplete.";

export const MANAGED_NOTION_REGISTRY_INCOMPLETE_USER_ACTION =
  "일부 registry 값이 있어 legacy target으로 전환하지 않았습니다. 기존 DB/필드는 자동 수정하지 않으니 Notion 설정/복구 화면에서 registry 상태를 확인해 주세요.";

export type ManagedNotionRegistryBlock = {
  snapshot: ManagedNotionRegistrySnapshot;
  message: string;
  userAction: string;
  technicalDetail: string;
};

export function blockPartialManagedNotionRegistry(
  registryStore: NotionRegistryStore | null | undefined,
  options: { includeDatabases?: boolean } = {},
): ManagedNotionRegistryBlock | null {
  const snapshot = readManagedNotionRegistrySnapshot(registryStore);
  if (snapshot.status !== "partial") {
    return null;
  }
  return {
    snapshot,
    message: MANAGED_NOTION_REGISTRY_INCOMPLETE_MESSAGE,
    userAction: MANAGED_NOTION_REGISTRY_INCOMPLETE_USER_ACTION,
    technicalDetail: JSON.stringify(managedRegistryDetail(snapshot, options)),
  };
}

export function hasCompleteManagedNotionUploadRegistry(
  registryStore: NotionRegistryStore | null | undefined,
): boolean {
  return hasReadyManagedNotionRegistry(registryStore);
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
