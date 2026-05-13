import { SqlRunner } from "../storage/sql-runner.js";
import { DEFAULT_PROJECT_ID } from "../projects/project-types.js";
import {
  databaseRoleForSemanticKey,
  NOTION_DATABASE_ROLES,
  NOTION_LOCALES,
  NOTION_PROPERTY_SEMANTIC_KEYS,
  type NotionDatabaseRole,
  type NotionLocale,
  type NotionPropertySemanticKey,
  type NotionSchemaPresetPropertyType,
} from "./schema-presets.js";

export const DEFAULT_NOTION_WORKSPACE_SETTINGS_ID = "default";

export const NOTION_PROPERTY_MAPPING_SOURCE_KINDS = [
  "system",
  "rollup",
  "user",
  "ai",
  "custom",
] as const;
export type NotionPropertyMappingSourceKind =
  (typeof NOTION_PROPERTY_MAPPING_SOURCE_KINDS)[number];

const NOTION_SCHEMA_PRESET_PROPERTY_TYPES = [
  "title",
  "rich_text",
  "date",
  "people",
  "select",
  "multi_select",
  "status",
  "relation",
  "rollup",
] as const satisfies readonly NotionSchemaPresetPropertyType[];

export type NotionWorkspaceSettings = {
  projectId?: string;
  id: string;
  locale: NotionLocale;
  parentPageUrl: string;
  parentPageId: string;
  createdAt: string;
  updatedAt: string;
};

export type SaveNotionWorkspaceSettingsInput = {
  projectId?: string;
  id?: string;
  locale: NotionLocale;
  parentPageUrl: string;
  parentPageId: string;
  nowIso: string;
};

export type NotionManagedDatabase = {
  projectId?: string;
  role: NotionDatabaseRole;
  locale: NotionLocale;
  databaseId: string;
  dataSourceId: string;
  url: string;
  name: string;
  createdByDirong: boolean;
  schemaVersion: string;
  createdAt: string;
  updatedAt: string;
};

export type UpsertNotionManagedDatabaseInput = {
  projectId?: string;
  role: NotionDatabaseRole;
  locale: NotionLocale;
  databaseId: string;
  dataSourceId: string;
  url: string;
  name: string;
  createdByDirong: boolean;
  schemaVersion: string;
  nowIso: string;
};

export type NotionPropertyMapping = {
  projectId?: string;
  databaseRole: NotionDatabaseRole;
  semanticKey: NotionPropertySemanticKey;
  propertyName: string;
  propertyId: string | null;
  propertyType: NotionSchemaPresetPropertyType;
  locked: boolean;
  sourceKind: NotionPropertyMappingSourceKind;
  createdAt: string;
  updatedAt: string;
};

export type UpsertNotionPropertyMappingInput = {
  projectId?: string;
  databaseRole: NotionDatabaseRole;
  semanticKey: NotionPropertySemanticKey;
  propertyName: string;
  propertyId?: string | null;
  propertyType: NotionSchemaPresetPropertyType;
  locked: boolean;
  sourceKind: NotionPropertyMappingSourceKind;
  nowIso: string;
};

export type ReplaceNotionPropertyMappingsInput = {
  projectId?: string;
  databaseRole: NotionDatabaseRole;
  mappings: ReadonlyArray<
    Omit<UpsertNotionPropertyMappingInput, "databaseRole" | "nowIso">
  >;
  nowIso: string;
};

export type SaveNotionManagedSchemaInput = {
  projectId?: string;
  workspaceSettings: Omit<SaveNotionWorkspaceSettingsInput, "nowIso">;
  managedDatabases: ReadonlyArray<
    Omit<UpsertNotionManagedDatabaseInput, "nowIso">
  >;
  propertyMappings: ReadonlyArray<
    Omit<UpsertNotionPropertyMappingInput, "nowIso">
  >;
  nowIso: string;
};

export type ClearNotionRegistryProjectResult = {
  workspaceSettings: number;
  managedDatabases: number;
  propertyMappings: number;
};

type NotionWorkspaceSettingsRow = {
  project_id: string;
  id: string;
  locale: string;
  parent_page_url: string;
  parent_page_id: string;
  created_at: string;
  updated_at: string;
};

type NotionManagedDatabaseRow = {
  project_id: string;
  role: string;
  locale: string;
  database_id: string;
  data_source_id: string;
  url: string;
  name: string;
  created_by_dirong: number;
  schema_version: string;
  created_at: string;
  updated_at: string;
};

type NotionPropertyMappingRow = {
  project_id: string;
  database_role: string;
  semantic_key: string;
  property_name: string;
  property_id: string | null;
  property_type: string;
  locked: number;
  source_kind: string;
  created_at: string;
  updated_at: string;
};

export class NotionRegistryStore {
  constructor(private readonly runner: SqlRunner) {}

  transaction<T>(fn: () => T): T {
    return this.runner.transaction(fn);
  }

  saveWorkspaceSettings(
    input: SaveNotionWorkspaceSettingsInput,
  ): NotionWorkspaceSettings {
    const savedIdentity = this.writeWorkspaceSettings(input);

    const saved = this.getWorkspaceSettings(
      savedIdentity.id,
      savedIdentity.projectId,
    );
    if (!saved) {
      throw new Error("Notion workspace settings를 저장하지 못했습니다.");
    }
    return saved;
  }

  getWorkspaceSettings(
    id = DEFAULT_NOTION_WORKSPACE_SETTINGS_ID,
    projectId = DEFAULT_PROJECT_ID,
  ): NotionWorkspaceSettings | null {
    const row = this.runner.get<NotionWorkspaceSettingsRow>(
      `SELECT *
       FROM notion_workspace_settings
       WHERE project_id = ?
         AND id = ?`,
      cleanRequiredString(projectId, "project id"),
      cleanRequiredString(id, "workspace settings id"),
    );
    return row ? rowToWorkspaceSettings(row) : null;
  }

  upsertManagedDatabase(
    input: UpsertNotionManagedDatabaseInput,
  ): NotionManagedDatabase {
    const savedIdentity = this.writeManagedDatabase(input);

    const saved = this.getManagedDatabase(
      savedIdentity.role,
      savedIdentity.projectId,
    );
    if (!saved) {
      throw new Error("Notion managed database를 저장하지 못했습니다.");
    }
    return saved;
  }

  getManagedDatabase(
    role: NotionDatabaseRole,
    projectId = DEFAULT_PROJECT_ID,
  ): NotionManagedDatabase | null {
    const row = this.runner.get<NotionManagedDatabaseRow>(
      `SELECT *
       FROM notion_managed_databases
       WHERE project_id = ?
         AND role = ?`,
      cleanRequiredString(projectId, "project id"),
      requireNotionDatabaseRole(role),
    );
    return row ? rowToManagedDatabase(row) : null;
  }

  listManagedDatabases(projectId = DEFAULT_PROJECT_ID): NotionManagedDatabase[] {
    return this.runner
      .all<NotionManagedDatabaseRow>(
        `SELECT *
         FROM notion_managed_databases
         WHERE project_id = ?
         ORDER BY role ASC`,
        cleanRequiredString(projectId, "project id"),
      )
      .map(rowToManagedDatabase);
  }

  upsertPropertyMapping(
    input: UpsertNotionPropertyMappingInput,
  ): NotionPropertyMapping {
    this.writePropertyMapping(input);

    const saved = this.getPropertyMapping(
      input.databaseRole,
      input.semanticKey,
      input.projectId ?? DEFAULT_PROJECT_ID,
    );
    if (!saved) {
      throw new Error("Notion property mapping을 저장하지 못했습니다.");
    }
    return saved;
  }

  getPropertyMapping(
    databaseRole: NotionDatabaseRole,
    semanticKey: NotionPropertySemanticKey,
    projectId = DEFAULT_PROJECT_ID,
  ): NotionPropertyMapping | null {
    const role = requireNotionDatabaseRole(databaseRole);
    const key = requireSemanticKeyForRole(semanticKey, role);
    const row = this.runner.get<NotionPropertyMappingRow>(
      `SELECT *
       FROM notion_property_mappings
       WHERE project_id = ?
         AND database_role = ?
         AND semantic_key = ?`,
      cleanRequiredString(projectId, "project id"),
      role,
      key,
    );
    return row ? rowToPropertyMapping(row) : null;
  }

  listPropertyMappings(
    databaseRole?: NotionDatabaseRole,
    projectId = DEFAULT_PROJECT_ID,
  ): NotionPropertyMapping[] {
    const resolvedProjectId = cleanRequiredString(projectId, "project id");
    if (databaseRole === undefined) {
      return this.runner
        .all<NotionPropertyMappingRow>(
          `SELECT *
           FROM notion_property_mappings
           WHERE project_id = ?
           ORDER BY database_role ASC, semantic_key ASC`,
          resolvedProjectId,
        )
        .map(rowToPropertyMapping);
    }

    return this.runner
      .all<NotionPropertyMappingRow>(
        `SELECT *
         FROM notion_property_mappings
         WHERE project_id = ?
           AND database_role = ?
         ORDER BY semantic_key ASC`,
        resolvedProjectId,
        requireNotionDatabaseRole(databaseRole),
      )
      .map(rowToPropertyMapping);
  }

  replacePropertyMappingsForDatabaseRole(
    input: ReplaceNotionPropertyMappingsInput,
  ): NotionPropertyMapping[] {
    const role = requireNotionDatabaseRole(input.databaseRole);
    const projectId = cleanRequiredString(
      input.projectId ?? DEFAULT_PROJECT_ID,
      "project id",
    );
    const nowIso = cleanRequiredString(input.nowIso, "nowIso");

    this.runner.transaction(() => {
      this.runner.run(
        `DELETE FROM notion_property_mappings
         WHERE project_id = ?
           AND database_role = ?`,
        projectId,
        role,
      );
      for (const mapping of input.mappings) {
        this.writePropertyMapping({
          ...mapping,
          projectId,
          databaseRole: role,
          nowIso,
        });
      }
    });

    return this.listPropertyMappings(role, projectId);
  }

  saveManagedSchema(input: SaveNotionManagedSchemaInput): void {
    const nowIso = cleanRequiredString(input.nowIso, "nowIso");
    const projectId = cleanRequiredString(
      input.projectId ?? DEFAULT_PROJECT_ID,
      "project id",
    );
    this.runner.transaction(() => {
      this.writeWorkspaceSettings({
        ...input.workspaceSettings,
        projectId,
        nowIso,
      });

      for (const database of input.managedDatabases) {
        this.writeManagedDatabase({
          ...database,
          projectId,
          nowIso,
        });
      }

      const rolesWithMappings = new Set(
        input.propertyMappings.map((mapping) =>
          requireNotionDatabaseRole(mapping.databaseRole),
        ),
      );
      for (const role of rolesWithMappings) {
        this.runner.run(
          `DELETE FROM notion_property_mappings
           WHERE project_id = ?
             AND database_role = ?`,
          projectId,
          role,
        );
      }
      for (const mapping of input.propertyMappings) {
        this.writePropertyMapping({
          ...mapping,
          projectId,
          nowIso,
        });
      }
    });
  }

  clearProject(projectId = DEFAULT_PROJECT_ID): ClearNotionRegistryProjectResult {
    const resolvedProjectId = cleanRequiredString(projectId, "project id");
    let propertyMappings = 0;
    let managedDatabases = 0;
    let workspaceSettings = 0;
    this.runner.transaction(() => {
      propertyMappings = this.runner.run(
        "DELETE FROM notion_property_mappings WHERE project_id = ?",
        resolvedProjectId,
      );
      managedDatabases = this.runner.run(
        "DELETE FROM notion_managed_databases WHERE project_id = ?",
        resolvedProjectId,
      );
      workspaceSettings = this.runner.run(
        "DELETE FROM notion_workspace_settings WHERE project_id = ?",
        resolvedProjectId,
      );
    });
    return { workspaceSettings, managedDatabases, propertyMappings };
  }

  private writeWorkspaceSettings(
    input: SaveNotionWorkspaceSettingsInput,
  ): { projectId: string; id: string } {
    const projectId = cleanRequiredString(
      input.projectId ?? DEFAULT_PROJECT_ID,
      "project id",
    );
    const id = cleanRequiredString(
      input.id ?? DEFAULT_NOTION_WORKSPACE_SETTINGS_ID,
      "workspace settings id",
    );
    const locale = requireNotionLocale(input.locale);
    const parentPageUrl = cleanRequiredString(
      input.parentPageUrl,
      "parent page URL",
    );
    const parentPageId = cleanRequiredString(
      input.parentPageId,
      "parent page id",
    );
    const nowIso = cleanRequiredString(input.nowIso, "nowIso");

    this.runner.run(
      `INSERT INTO notion_workspace_settings (
         project_id, id, locale, parent_page_url, parent_page_id,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET
         id = excluded.id,
         locale = excluded.locale,
         parent_page_url = excluded.parent_page_url,
         parent_page_id = excluded.parent_page_id,
         updated_at = excluded.updated_at`,
      projectId,
      id,
      locale,
      parentPageUrl,
      parentPageId,
      nowIso,
      nowIso,
    );

    return { projectId, id };
  }

  private writeManagedDatabase(
    input: UpsertNotionManagedDatabaseInput,
  ): { projectId: string; role: NotionDatabaseRole } {
    const projectId = cleanRequiredString(
      input.projectId ?? DEFAULT_PROJECT_ID,
      "project id",
    );
    const role = requireNotionDatabaseRole(input.role);
    const locale = requireNotionLocale(input.locale);
    const databaseId = cleanRequiredString(input.databaseId, "database id");
    const dataSourceId = cleanRequiredString(
      input.dataSourceId,
      "data source id",
    );
    const url = cleanRequiredString(input.url, "database URL");
    const name = cleanRequiredString(input.name, "database name");
    const schemaVersion = cleanRequiredString(
      input.schemaVersion,
      "schema version",
    );
    const nowIso = cleanRequiredString(input.nowIso, "nowIso");

    this.runner.run(
      `INSERT INTO notion_managed_databases (
         project_id, role, locale, database_id, data_source_id, url, name,
         created_by_dirong, schema_version, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, role) DO UPDATE SET
         locale = excluded.locale,
         database_id = excluded.database_id,
         data_source_id = excluded.data_source_id,
         url = excluded.url,
         name = excluded.name,
         created_by_dirong = excluded.created_by_dirong,
         schema_version = excluded.schema_version,
         updated_at = excluded.updated_at`,
      projectId,
      role,
      locale,
      databaseId,
      dataSourceId,
      url,
      name,
      input.createdByDirong ? 1 : 0,
      schemaVersion,
      nowIso,
      nowIso,
    );

    return { projectId, role };
  }

  private writePropertyMapping(input: UpsertNotionPropertyMappingInput): void {
    const projectId = cleanRequiredString(
      input.projectId ?? DEFAULT_PROJECT_ID,
      "project id",
    );
    const databaseRole = requireNotionDatabaseRole(input.databaseRole);
    const semanticKey = requireSemanticKeyForRole(
      input.semanticKey,
      databaseRole,
    );
    const propertyName = cleanRequiredString(input.propertyName, "property name");
    const propertyId = cleanNullableString(input.propertyId ?? null);
    const propertyType = requireNotionPropertyType(input.propertyType);
    const sourceKind = requirePropertyMappingSourceKind(input.sourceKind);
    const nowIso = cleanRequiredString(input.nowIso, "nowIso");

    this.runner.run(
      `INSERT INTO notion_property_mappings (
         project_id, database_role, semantic_key, property_name, property_id,
         property_type, locked, source_kind, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, database_role, semantic_key) DO UPDATE SET
         property_name = excluded.property_name,
         property_id = excluded.property_id,
         property_type = excluded.property_type,
         locked = excluded.locked,
         source_kind = excluded.source_kind,
         updated_at = excluded.updated_at`,
      projectId,
      databaseRole,
      semanticKey,
      propertyName,
      propertyId,
      propertyType,
      input.locked ? 1 : 0,
      sourceKind,
      nowIso,
      nowIso,
    );
  }
}

function rowToWorkspaceSettings(
  row: NotionWorkspaceSettingsRow,
): NotionWorkspaceSettings {
  return {
    projectId: row.project_id,
    id: row.id,
    locale: requireNotionLocale(row.locale),
    parentPageUrl: row.parent_page_url,
    parentPageId: row.parent_page_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToManagedDatabase(
  row: NotionManagedDatabaseRow,
): NotionManagedDatabase {
  return {
    projectId: row.project_id,
    role: requireNotionDatabaseRole(row.role),
    locale: requireNotionLocale(row.locale),
    databaseId: row.database_id,
    dataSourceId: row.data_source_id,
    url: row.url,
    name: row.name,
    createdByDirong: row.created_by_dirong === 1,
    schemaVersion: row.schema_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToPropertyMapping(
  row: NotionPropertyMappingRow,
): NotionPropertyMapping {
  const databaseRole = requireNotionDatabaseRole(row.database_role);
  return {
    projectId: row.project_id,
    databaseRole,
    semanticKey: requireSemanticKeyForRole(row.semantic_key, databaseRole),
    propertyName: row.property_name,
    propertyId: row.property_id,
    propertyType: requireNotionPropertyType(row.property_type),
    locked: row.locked === 1,
    sourceKind: requirePropertyMappingSourceKind(row.source_kind),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requireNotionLocale(value: string): NotionLocale {
  if ((NOTION_LOCALES as readonly string[]).includes(value)) {
    return value as NotionLocale;
  }
  throw new Error(`Invalid Notion locale: ${String(value)}`);
}

function requireNotionDatabaseRole(value: string): NotionDatabaseRole {
  if ((NOTION_DATABASE_ROLES as readonly string[]).includes(value)) {
    return value as NotionDatabaseRole;
  }
  throw new Error(`Invalid Notion database role: ${String(value)}`);
}

function requireSemanticKeyForRole(
  value: string,
  databaseRole: NotionDatabaseRole,
): NotionPropertySemanticKey {
  if (!(NOTION_PROPERTY_SEMANTIC_KEYS as readonly string[]).includes(value)) {
    throw new Error(`Invalid Notion property semantic key: ${String(value)}`);
  }

  const semanticKey = value as NotionPropertySemanticKey;
  const expectedRole = databaseRoleForSemanticKey(semanticKey);
  if (expectedRole !== databaseRole) {
    throw new Error(
      `Invalid Notion property semantic key ${semanticKey} for ${databaseRole} database.`,
    );
  }
  return semanticKey;
}

function requireNotionPropertyType(
  value: string,
): NotionSchemaPresetPropertyType {
  if ((NOTION_SCHEMA_PRESET_PROPERTY_TYPES as readonly string[]).includes(value)) {
    return value as NotionSchemaPresetPropertyType;
  }
  throw new Error(`Invalid Notion property type: ${String(value)}`);
}

function requirePropertyMappingSourceKind(
  value: string,
): NotionPropertyMappingSourceKind {
  if ((NOTION_PROPERTY_MAPPING_SOURCE_KINDS as readonly string[]).includes(value)) {
    return value as NotionPropertyMappingSourceKind;
  }
  throw new Error(`Invalid Notion property mapping source kind: ${String(value)}`);
}

function cleanRequiredString(value: string, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
  const cleaned = value.trim();
  if (!cleaned) {
    throw new Error(`${label} must not be empty.`);
  }
  return cleaned;
}

function cleanNullableString(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error("nullable string value must be a string or null.");
  }
  const cleaned = value.trim();
  return cleaned || null;
}
