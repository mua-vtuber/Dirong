import type {
  JsonObject,
  NotionClient,
  NotionDataSourceResponse,
} from "./client.js";
import {
  KOREAN_NOTION_SCHEMA_PRESET,
  type NotionDatabaseRole,
  type NotionLocale,
  type NotionPropertySemanticKey,
  type NotionRollupPresetTarget,
  type NotionSchemaPreset,
  type NotionSchemaPresetDatabase,
  type NotionSchemaPresetProperty,
  type NotionSchemaPresetPropertyType,
  validateNotionSchemaPreset,
} from "./schema-presets.js";
import {
  type NotionManagedDatabase,
  type NotionPropertyMapping,
  type NotionPropertyMappingSourceKind,
  NotionRegistryStore,
} from "./registry-store.js";
import { parseNotionPageUrl } from "./target.js";
import {
  isRecord,
  readDataSourcePropertyMap,
  readFirstDataSourceId,
} from "./data-source-readers.js";
import { managedSelectOptionSchema } from "./property-shape.js";

export const NOTION_MANAGED_SCHEMA_VERSION = "notion-managed-db-v1";

const MANAGED_DATABASE_CREATE_ORDER = ["member", "meeting", "task"] as const;

type CreateManagedNotionSchemaInput = {
  client: NotionClient;
  registryStore: NotionRegistryStore;
  projectId?: string;
  parentPageUrl: string;
  locale?: NotionLocale;
  nowIso?: string;
};

export type ManagedNotionDatabaseCreation = {
  role: NotionDatabaseRole;
  name: string;
  databaseId: string;
  dataSourceId: string;
  url: string;
};

export type ManagedNotionSchemaCreationResult = {
  locale: NotionLocale;
  parentPageUrl: string;
  parentPageId: string;
  databases: Record<NotionDatabaseRole, ManagedNotionDatabaseCreation>;
  propertyMappings: Record<NotionDatabaseRole, NotionPropertyMapping[]>;
};

type CreatedDatabaseContext = ManagedNotionDatabaseCreation & {
  dataSource: NotionDataSourceResponse;
  propertiesBySemanticKey: Map<NotionPropertySemanticKey, CreatedProperty>;
};

type CreatedMeetingTaskRelationContexts = {
  meeting: CreatedDatabaseContext;
  task: CreatedDatabaseContext;
};

type CreatedProperty = {
  semanticKey: NotionPropertySemanticKey;
  name: string;
  id: string | null;
  type: NotionSchemaPresetPropertyType;
};

export async function createManagedNotionSchema(
  input: CreateManagedNotionSchemaInput,
): Promise<ManagedNotionSchemaCreationResult> {
  const locale = input.locale ?? "ko";
  const preset = getCreatablePreset(locale);
  const validation = validateNotionSchemaPreset(preset);
  if (!validation.ok) {
    throw new Error(
      `Notion schema preset이 유효하지 않습니다: ${validation.errors
        .map((error) => error.message)
        .join(" ")}`,
    );
  }

  const parsedPage = parseNotionPageUrl(input.parentPageUrl);
  if (parsedPage.kind !== "page_id") {
    throw new Error(`Notion 부모 page URL이 유효하지 않습니다: ${parsedPage.reason}`);
  }

  await input.client.retrievePage(parsedPage.id);

  const createdByRole = new Map<NotionDatabaseRole, CreatedDatabaseContext>();
  for (const role of MANAGED_DATABASE_CREATE_ORDER) {
    const created = await createManagedDatabase({
      client: input.client,
      preset,
      role,
      parentPageId: parsedPage.id,
      createdByRole,
    });
    createdByRole.set(role, created);
  }

  const meeting = requireCreatedDatabase(createdByRole, "meeting");
  const task = requireCreatedDatabase(createdByRole, "task");
  const withTaskRelation = await addTaskMeetingRelation({
    client: input.client,
    preset,
    meeting,
    task,
  });
  createdByRole.set("meeting", withTaskRelation.meeting);
  createdByRole.set("task", withTaskRelation.task);

  const nowIso = input.nowIso ?? new Date().toISOString();
  const managedDatabases = MANAGED_DATABASE_CREATE_ORDER.map((role) =>
    createdContextToManagedDatabaseInput(
      requireCreatedDatabase(createdByRole, role),
      locale,
    ),
  );
  const propertyMappings = MANAGED_DATABASE_CREATE_ORDER.flatMap((role) =>
    createdContextToPropertyMappingInputs(
      requireCreatedDatabase(createdByRole, role),
      preset.databases[role],
    ),
  );

  input.registryStore.saveManagedSchema({
    projectId: input.projectId,
    workspaceSettings: {
      projectId: input.projectId,
      locale,
      parentPageUrl: parsedPage.url ?? input.parentPageUrl.trim(),
      parentPageId: parsedPage.id,
    },
    managedDatabases,
    propertyMappings,
    nowIso,
  });

  return {
    locale,
    parentPageUrl: parsedPage.url ?? input.parentPageUrl.trim(),
    parentPageId: parsedPage.id,
    databases: createdDatabasesToRecord(createdByRole),
    propertyMappings: loadSavedPropertyMappings(input.registryStore, input.projectId),
  };
}

async function createManagedDatabase(input: {
  client: NotionClient;
  preset: NotionSchemaPreset;
  role: NotionDatabaseRole;
  parentPageId: string;
  createdByRole: ReadonlyMap<NotionDatabaseRole, CreatedDatabaseContext>;
}): Promise<CreatedDatabaseContext> {
  const databasePreset = input.preset.databases[input.role];
  const createResponse = await input.client.createDatabase(
    buildCreateDatabaseBody({
      parentPageId: input.parentPageId,
      database: databasePreset,
      role: input.role,
      createdByRole: input.createdByRole,
    }),
  );
  const databaseId = readRequiredString(createResponse, "id", "database id");
  const dataSourceId =
    readFirstDataSourceId(createResponse) ??
    (await retrieveFirstDataSourceId(input.client, databaseId));
  const dataSource = await input.client.retrieveDataSource(dataSourceId);

  return buildCreatedDatabaseContext({
    role: input.role,
    database: initialDatabasePreset(input.role, databasePreset),
    databaseId,
    dataSourceId,
    url: readOptionalString(createResponse, "url") ?? notionDatabaseUrl(databaseId),
    dataSource,
  });
}

export function buildCreateDatabaseBody(input: {
  parentPageId: string;
  database: NotionSchemaPresetDatabase;
  role: NotionDatabaseRole;
  createdByRole: ReadonlyMap<NotionDatabaseRole, CreatedDatabaseContext>;
}): JsonObject {
  return {
    parent: {
      type: "page_id",
      page_id: input.parentPageId,
    },
    title: richText(input.database.name),
    is_inline: false,
    initial_data_source: {
      properties: buildInitialDataSourceProperties({
        database: input.database,
        role: input.role,
        createdByRole: input.createdByRole,
      }),
    },
  };
}

function buildInitialDataSourceProperties(input: {
  database: NotionSchemaPresetDatabase;
  role: NotionDatabaseRole;
  createdByRole: ReadonlyMap<NotionDatabaseRole, CreatedDatabaseContext>;
}): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const property of input.database.properties) {
    if (
      property.key === "meeting.actionItems" ||
      property.key === "task.meeting"
    ) {
      continue;
    }
    properties[property.name] = buildPropertySchema({
      property,
      database: input.database,
      role: input.role,
      createdByRole: input.createdByRole,
    });
  }
  return properties;
}

function buildPropertySchema(input: {
  property: NotionSchemaPresetProperty;
  database: NotionSchemaPresetDatabase;
  role: NotionDatabaseRole;
  createdByRole: ReadonlyMap<NotionDatabaseRole, CreatedDatabaseContext>;
}): Record<string, unknown> {
  const { property } = input;
  if (property.type === "title") {
    return { title: {} };
  }
  if (property.type === "rich_text") {
    return { rich_text: {} };
  }
  if (property.type === "date") {
    return { date: {} };
  }
  if (property.type === "people") {
    return { people: {} };
  }
  if (property.type === "multi_select") {
    return {
      multi_select: {
        options: (property.options ?? []).map((name) => ({ name })),
      },
    };
  }
  if (property.type === "select" || property.type === "status") {
    return {
      [property.type]: {
        options: (property.options ?? []).map(managedSelectOptionSchema),
      },
    };
  }
  if (property.type === "relation") {
    return { relation: buildRelationSchema(property, input.createdByRole) };
  }
  return {
    rollup: buildRollupSchema(
      property,
      input.database,
      input.createdByRole,
    ),
  };
}

function buildRelationSchema(
  property: NotionSchemaPresetProperty,
  createdByRole: ReadonlyMap<NotionDatabaseRole, CreatedDatabaseContext>,
): JsonObject {
  if (!property.relation) {
    throw new Error(`${property.key} relation target이 없습니다.`);
  }
  const target = requireCreatedDatabase(
    createdByRole,
    property.relation.targetDatabase,
  );

  if (property.relation.mode === "synced") {
    const source = target.propertiesBySemanticKey.get(
      property.relation.sourceProperty,
    );
    return {
      data_source_id: target.dataSourceId,
      type: "dual_property",
      dual_property: {
        ...(source?.id ? { synced_property_id: source.id } : {}),
        synced_property_name:
          source?.name ??
          presetPropertyName(property.relation.sourceProperty),
      },
    };
  }

  return {
    data_source_id: target.dataSourceId,
    type: "single_property",
    single_property: {},
  };
}

function buildRollupSchema(
  property: NotionSchemaPresetProperty,
  database: NotionSchemaPresetDatabase,
  createdByRole: ReadonlyMap<NotionDatabaseRole, CreatedDatabaseContext>,
): JsonObject {
  if (!property.rollup) {
    throw new Error(`${property.key} rollup target이 없습니다.`);
  }

  const relation = resolveRollupRelation(
    property.rollup,
    database,
    createdByRole,
  );
  const target = resolveRollupTarget(property.rollup, createdByRole);
  const rollupSchema: JsonObject = {
    function: "show_original",
    relation_property_name: relation.name,
    rollup_property_name: target.name,
  };
  if (relation.id) {
    rollupSchema.relation_property_id = relation.id;
  }
  if (target.id) {
    rollupSchema.rollup_property_id = target.id;
  }
  return rollupSchema;
}

async function addTaskMeetingRelation(input: {
  client: NotionClient;
  preset: NotionSchemaPreset;
  meeting: CreatedDatabaseContext;
  task: CreatedDatabaseContext;
}): Promise<CreatedMeetingTaskRelationContexts> {
  const property = input.preset.databases.task.properties.find(
    (item) => item.key === "task.meeting",
  );
  if (!property) {
    throw new Error("task.meeting preset이 없습니다.");
  }

  await input.client.updateDataSource(input.task.dataSourceId, {
    properties: {
      [property.name]: buildTaskMeetingRelationSchema({
        meeting: input.meeting,
        actionItemsName: presetPropertyName("meeting.actionItems"),
      }),
    },
  });

  const taskDataSource = await input.client.retrieveDataSource(
    input.task.dataSourceId,
  );
  const meetingDataSource = await ensureMeetingActionItemsRelationName({
    client: input.client,
    meeting: input.meeting,
    task: input.task,
    meetingDataSource: await input.client.retrieveDataSource(
      input.meeting.dataSourceId,
    ),
    expectedName: presetPropertyName("meeting.actionItems"),
  });

  return {
    meeting: buildCreatedDatabaseContext({
      ...input.meeting,
      database: input.preset.databases.meeting,
      dataSource: meetingDataSource,
    }),
    task: buildCreatedDatabaseContext({
      ...input.task,
      database: input.preset.databases.task,
      dataSource: taskDataSource,
    }),
  };
}

function buildTaskMeetingRelationSchema(input: {
  meeting: CreatedDatabaseContext;
  actionItemsName: string;
}): JsonObject {
  return {
    type: "relation",
    relation: {
      data_source_id: input.meeting.dataSourceId,
      type: "dual_property",
      dual_property: {
        synced_property_name: input.actionItemsName,
      },
    },
  };
}

function buildCreatedDatabaseContext(input: {
  role: NotionDatabaseRole;
  database: NotionSchemaPresetDatabase;
  databaseId: string;
  dataSourceId: string;
  url: string;
  dataSource: NotionDataSourceResponse;
}): CreatedDatabaseContext {
  return {
    role: input.role,
    name: input.database.name,
    databaseId: input.databaseId,
    dataSourceId: input.dataSourceId,
    url: input.url,
    dataSource: input.dataSource,
    propertiesBySemanticKey: extractCreatedProperties(
      input.database,
      input.dataSource,
    ),
  };
}

function initialDatabasePreset(
  role: NotionDatabaseRole,
  database: NotionSchemaPresetDatabase,
): NotionSchemaPresetDatabase {
  if (role !== "meeting") {
    if (role === "task") {
      return {
        ...database,
        properties: database.properties.filter(
          (property) => property.key !== "task.meeting",
        ),
      };
    }
    return database;
  }
  return {
    ...database,
    properties: database.properties.filter(
      (property) => property.key !== "meeting.actionItems",
    ),
  };
}

async function ensureMeetingActionItemsRelationName(input: {
  client: NotionClient;
  meeting: CreatedDatabaseContext;
  task: CreatedDatabaseContext;
  meetingDataSource: NotionDataSourceResponse;
  expectedName: string;
}): Promise<NotionDataSourceResponse> {
  const relation = findRelationToDataSource(
    input.meetingDataSource,
    input.task.dataSourceId,
  );
  if (!relation) {
    throw new Error(
      `${input.meeting.role} Notion DB에서 ${input.task.role} relation을 찾지 못했습니다.`,
    );
  }
  if (relation.name === input.expectedName) {
    return input.meetingDataSource;
  }

  await input.client.updateDataSource(input.meeting.dataSourceId, {
    properties: {
      [relation.id ?? relation.name]: {
        name: input.expectedName,
      },
    },
  });
  return input.client.retrieveDataSource(input.meeting.dataSourceId);
}

function findRelationToDataSource(
  dataSource: NotionDataSourceResponse,
  targetDataSourceId: string,
): { id: string | null; name: string } | null {
  for (const [fallbackName, value] of readDataSourcePropertyMap(dataSource)) {
    const relation = value.relation;
    if (
      isRecord(relation) &&
      relation.data_source_id === targetDataSourceId
    ) {
      return {
        id: readOptionalString(value, "id"),
        name: readOptionalString(value, "name") ?? fallbackName,
      };
    }
  }
  return null;
}

function presetPropertyName(semanticKey: NotionPropertySemanticKey): string {
  for (const database of Object.values(KOREAN_NOTION_SCHEMA_PRESET.databases)) {
    const property = database.properties.find((item) => item.key === semanticKey);
    if (property) {
      return property.name;
    }
  }
  throw new Error(`${semanticKey} preset property를 찾지 못했습니다.`);
}

function extractCreatedProperties(
  database: NotionSchemaPresetDatabase,
  dataSource: NotionDataSourceResponse,
): Map<NotionPropertySemanticKey, CreatedProperty> {
  const actualByName = readDataSourcePropertyMap(dataSource);
  const properties = new Map<NotionPropertySemanticKey, CreatedProperty>();
  for (const presetProperty of database.properties) {
    const actual = actualByName.get(presetProperty.name);
    if (!actual) {
      throw new Error(
        `Notion data source 응답에서 ${presetProperty.name} 속성을 찾지 못했습니다.`,
      );
    }
    const actualType = readOptionalString(actual, "type");
    if (!actualType) {
      throw new Error(`${presetProperty.name} 속성 type을 찾지 못했습니다.`);
    }
    properties.set(presetProperty.key, {
      semanticKey: presetProperty.key,
      name: readOptionalString(actual, "name") ?? presetProperty.name,
      id: readOptionalString(actual, "id"),
      type: requirePresetPropertyType(actualType),
    });
  }
  return properties;
}

function resolveRollupRelation(
  rollup: NotionRollupPresetTarget,
  database: NotionSchemaPresetDatabase,
  createdByRole: ReadonlyMap<NotionDatabaseRole, CreatedDatabaseContext>,
): CreatedProperty {
  const relationRole = semanticKeyToDatabaseRole(rollup.relationProperty);
  const createdDatabase = createdByRole.get(relationRole);
  if (createdDatabase) {
    return requireCreatedProperty(createdDatabase, rollup.relationProperty);
  }

  const presetRelation = database.properties.find(
    (property) => property.key === rollup.relationProperty,
  );
  if (!presetRelation) {
    throw new Error(`${rollup.relationProperty} rollup relation을 찾지 못했습니다.`);
  }
  return {
    semanticKey: presetRelation.key,
    name: presetRelation.name,
    id: null,
    type: presetRelation.type,
  };
}

function resolveRollupTarget(
  rollup: NotionRollupPresetTarget,
  createdByRole: ReadonlyMap<NotionDatabaseRole, CreatedDatabaseContext>,
): CreatedProperty {
  const targetRole = semanticKeyToDatabaseRole(rollup.targetProperty);
  return requireCreatedProperty(
    requireCreatedDatabase(createdByRole, targetRole),
    rollup.targetProperty,
  );
}

async function retrieveFirstDataSourceId(
  client: NotionClient,
  databaseId: string,
): Promise<string> {
  const database = await client.retrieveDatabase(databaseId);
  const dataSourceId = readFirstDataSourceId(database);
  if (!dataSourceId) {
    throw new Error(`Notion database ${databaseId}에서 data source id를 찾지 못했습니다.`);
  }
  return dataSourceId;
}

function createdContextToManagedDatabaseInput(
  context: CreatedDatabaseContext,
  locale: NotionLocale,
): Omit<NotionManagedDatabase, "createdAt" | "updatedAt"> {
  return {
    role: context.role,
    locale,
    databaseId: context.databaseId,
    dataSourceId: context.dataSourceId,
    url: context.url,
    name: context.name,
    createdByDirong: true,
    schemaVersion: NOTION_MANAGED_SCHEMA_VERSION,
  };
}

function createdContextToPropertyMappingInputs(
  context: CreatedDatabaseContext,
  database: NotionSchemaPresetDatabase,
): Array<
  Omit<NotionPropertyMapping, "databaseRole" | "createdAt" | "updatedAt"> & {
    databaseRole: NotionDatabaseRole;
  }
> {
  return database.properties.map((presetProperty) => {
    const created = requireCreatedProperty(context, presetProperty.key);
    return {
      databaseRole: context.role,
      semanticKey: presetProperty.key,
      propertyName: created.name,
      propertyId: created.id,
      propertyType: created.type,
      locked: presetProperty.locked,
      sourceKind: sourceKindForPresetProperty(presetProperty),
    };
  });
}

function loadSavedPropertyMappings(
  registryStore: NotionRegistryStore,
  projectId: string | undefined,
): Record<NotionDatabaseRole, NotionPropertyMapping[]> {
  return {
    meeting: registryStore.listPropertyMappings("meeting", projectId),
    member: registryStore.listPropertyMappings("member", projectId),
    task: registryStore.listPropertyMappings("task", projectId),
  };
}

function createdDatabasesToRecord(
  createdByRole: ReadonlyMap<NotionDatabaseRole, CreatedDatabaseContext>,
): Record<NotionDatabaseRole, ManagedNotionDatabaseCreation> {
  return {
    meeting: stripCreatedContext(requireCreatedDatabase(createdByRole, "meeting")),
    member: stripCreatedContext(requireCreatedDatabase(createdByRole, "member")),
    task: stripCreatedContext(requireCreatedDatabase(createdByRole, "task")),
  };
}

function stripCreatedContext(
  context: CreatedDatabaseContext,
): ManagedNotionDatabaseCreation {
  return {
    role: context.role,
    name: context.name,
    databaseId: context.databaseId,
    dataSourceId: context.dataSourceId,
    url: context.url,
  };
}

function sourceKindForPresetProperty(
  property: NotionSchemaPresetProperty,
): NotionPropertyMappingSourceKind {
  if (property.type === "rollup") {
    return "rollup";
  }
  return "system";
}

function requireCreatedDatabase(
  createdByRole: ReadonlyMap<NotionDatabaseRole, CreatedDatabaseContext>,
  role: NotionDatabaseRole,
): CreatedDatabaseContext {
  const created = createdByRole.get(role);
  if (!created) {
    throw new Error(`${role} Notion DB가 아직 생성되지 않았습니다.`);
  }
  return created;
}

function requireCreatedProperty(
  context: CreatedDatabaseContext,
  semanticKey: NotionPropertySemanticKey,
): CreatedProperty {
  const property = context.propertiesBySemanticKey.get(semanticKey);
  if (!property) {
    throw new Error(`${context.role}.${semanticKey} Notion 속성을 찾지 못했습니다.`);
  }
  return property;
}

function getCreatablePreset(locale: NotionLocale): NotionSchemaPreset {
  if (locale !== "ko") {
    throw new Error("Phase 3에서는 한국어 Notion schema preset만 생성할 수 있습니다.");
  }
  return KOREAN_NOTION_SCHEMA_PRESET;
}

function semanticKeyToDatabaseRole(
  key: NotionPropertySemanticKey,
): NotionDatabaseRole {
  if (key.startsWith("meeting.")) {
    return "meeting";
  }
  if (key.startsWith("member.")) {
    return "member";
  }
  return "task";
}

function requirePresetPropertyType(value: string): NotionSchemaPresetPropertyType {
  if (
    value === "title" ||
    value === "rich_text" ||
    value === "date" ||
    value === "people" ||
    value === "select" ||
    value === "multi_select" ||
    value === "status" ||
    value === "relation" ||
    value === "rollup"
  ) {
    return value;
  }
  throw new Error(`지원하지 않는 Notion property type입니다: ${value}`);
}

function richText(content: string): Array<{ type: "text"; text: { content: string } }> {
  return [{ type: "text", text: { content } }];
}

function notionDatabaseUrl(databaseId: string): string {
  return `https://www.notion.so/${databaseId.replaceAll("-", "")}`;
}

function readRequiredString(
  value: JsonObject,
  key: string,
  label: string,
): string {
  const result = readOptionalString(value, key);
  if (!result) {
    throw new Error(`Notion 응답에서 ${label}를 찾지 못했습니다.`);
  }
  return result;
}

function readOptionalString(value: JsonObject, key: string): string | null {
  const raw = value[key];
  return typeof raw === "string" && raw.trim() ? raw : null;
}
