import { summarizeSafeError } from "../errors.js";
import type { NotionClient } from "./client.js";
import { readDataSourceProperties } from "./data-source-readers.js";
import {
  buildManagedSchemaDiff,
  type ManagedSchemaDiff,
  type ManagedSchemaRemoteStatus,
} from "./managed-schema-diff.js";
import {
  NOTION_DATABASE_ROLES,
  type NotionDatabaseRole,
} from "./schema-presets.js";
import {
  readManagedNotionRegistrySnapshot,
  type ManagedNotionRegistryDatabaseSnapshot,
  type ManagedNotionRegistrySnapshot,
} from "./managed-registry.js";
import type {
  NotionManagedDatabase,
  NotionRegistryStore,
} from "./registry-store.js";

export type ManagedNotionSchemaCheckStatus =
  | "unchecked"
  | "checking"
  | ManagedSchemaRemoteStatus
  | "failed";

export type ManagedNotionSchemaRoleStatus = {
  role: NotionDatabaseRole;
  registry: ManagedNotionRegistryDatabaseSnapshot;
  dataSourceId: string | null;
  remote: {
    status: ManagedNotionSchemaCheckStatus;
    checkedAt: string | null;
    error: string | null;
    warnings: string[];
    diff: ManagedSchemaDiff | null;
  };
};

export type ManagedNotionSchemaStatusSnapshot = {
  checkedAt: string;
  status: ManagedNotionSchemaCheckStatus;
  registry: ManagedNotionRegistrySnapshot;
  databases: ManagedNotionSchemaRoleStatus[];
};

export class ManagedNotionSchemaStatusService {
  constructor(
    private readonly input: {
      client: NotionClient;
      registryStore: NotionRegistryStore;
      now?: () => Date;
    },
  ) {}

  async checkAll(): Promise<ManagedNotionSchemaStatusSnapshot> {
    const checkedAt = this.nowIso();
    const registry = readManagedNotionRegistrySnapshot(this.input.registryStore);
    const managedDatabases = this.input.registryStore.listManagedDatabases();
    const databases: ManagedNotionSchemaRoleStatus[] = [];

    for (const role of NOTION_DATABASE_ROLES) {
      databases.push(
        await this.checkRole({
          role,
          checkedAt,
          registry,
          managedDatabases,
        }),
      );
    }

    return {
      checkedAt,
      status: aggregateStatus(databases.map((database) => database.remote.status)),
      registry,
      databases,
    };
  }

  private async checkRole(input: {
    role: NotionDatabaseRole;
    checkedAt: string;
    registry: ManagedNotionRegistrySnapshot;
    managedDatabases: readonly NotionManagedDatabase[];
  }): Promise<ManagedNotionSchemaRoleStatus> {
    const registry = requireRegistryDatabase(input.registry, input.role);
    const managedDatabase =
      input.managedDatabases.find((database) => database.role === input.role) ?? null;
    if (!managedDatabase) {
      return {
        role: input.role,
        registry,
        dataSourceId: null,
        remote: {
          status: "unchecked",
          checkedAt: null,
          error: null,
          warnings: [],
          diff: null,
        },
      };
    }

    try {
      const dataSource = await this.input.client.retrieveDataSource(
        managedDatabase.dataSourceId,
      );
      const diff = buildManagedSchemaDiff({
        databaseRole: input.role,
        properties: readDataSourceProperties(dataSource),
        mappings: this.input.registryStore.listPropertyMappings(),
        managedDatabases: input.managedDatabases,
      });
      return {
        role: input.role,
        registry,
        dataSourceId: managedDatabase.dataSourceId,
        remote: {
          status: diff.status,
          checkedAt: input.checkedAt,
          error: null,
          warnings: diff.warnings,
          diff,
        },
      };
    } catch (error) {
      return {
        role: input.role,
        registry,
        dataSourceId: managedDatabase.dataSourceId,
        remote: {
          status: "failed",
          checkedAt: input.checkedAt,
          error: summarizeSafeError(error),
          warnings: [],
          diff: null,
        },
      };
    }
  }

  private nowIso(): string {
    return (this.input.now?.() ?? new Date()).toISOString();
  }
}

function requireRegistryDatabase(
  registry: ManagedNotionRegistrySnapshot,
  role: NotionDatabaseRole,
): ManagedNotionRegistryDatabaseSnapshot {
  const database = registry.databases.find((item) => item.role === role);
  if (!database) {
    throw new Error(`${role} registry snapshot을 찾지 못했습니다.`);
  }
  return database;
}

function aggregateStatus(
  statuses: readonly ManagedNotionSchemaCheckStatus[],
): ManagedNotionSchemaCheckStatus {
  if (statuses.includes("manual_required")) {
    return "manual_required";
  }
  if (statuses.includes("failed")) {
    return "failed";
  }
  if (statuses.includes("needs_repair")) {
    return "needs_repair";
  }
  if (statuses.includes("checking")) {
    return "checking";
  }
  if (statuses.includes("unchecked")) {
    return "unchecked";
  }
  return "healthy";
}
