import type { NotionClient } from "./client.js";
import {
  readDataSourceProperties,
  readDataSources,
  readId,
  readTargetName,
} from "./data-source-readers.js";
import {
  blockPartialManagedNotionRegistry,
} from "./managed-registry-policy.js";
import {
  NotionRegistryStore,
  type NotionManagedDatabase,
  type NotionPropertyMapping,
} from "./registry-store.js";
import {
  validateNotionDataSourceSchema,
} from "./schema.js";
import { validateManagedDataSourceSchemaForUpload } from "./managed-schema-diff.js";
import type {
  NotionResolvedPropertyIds,
  NotionSemanticResolvedProperties,
  NotionSemanticResolvedProperty,
} from "./schema.js";
import type { NotionPropertySemanticKey } from "./schema-presets.js";
import type { NotionRuntimeSettings } from "./settings.js";
import { parseNotionTargetUrl } from "./target.js";
import {
  createWriterValidationError,
  type NotionUploadResult,
} from "./upload-result.js";

export type ResolvedTargetBase = {
  id: string;
  name: string;
  url: string;
  dataSource: Record<string, unknown>;
  draftIdPropertyName: string;
  sessionIdPropertyName: string;
};

export type RemoteResolvedTarget = {
  id: string;
  name: string;
  dataSource: Record<string, unknown>;
};

export type LegacyResolvedTarget = ResolvedTargetBase & {
  kind: "legacy";
  propertyIds: NotionResolvedPropertyIds;
  propertyNames: NotionRuntimeSettings["propertyNames"];
};

export type ManagedResolvedTarget = ResolvedTargetBase & {
  kind: "managed";
  meetingDatabase: NotionManagedDatabase;
  memberDatabase: NotionManagedDatabase;
  meetingProperties: NotionSemanticResolvedProperties;
  memberDiscordNameProperty: NotionSemanticResolvedProperty;
  actionItemTarget: {
    database: NotionManagedDatabase;
    properties: NotionSemanticResolvedProperties;
  } | null;
  actionItemWarnings: string[];
};

export type ResolvedTarget = LegacyResolvedTarget | ManagedResolvedTarget;

type ManagedUploadRegistryCandidate = {
  meetingDatabase: NotionManagedDatabase;
  memberDatabase: NotionManagedDatabase;
  taskDatabase: NotionManagedDatabase | null;
  managedDatabases: NotionManagedDatabase[];
  allMappings: NotionPropertyMapping[];
  meetingMappings: NotionPropertyMapping[];
  memberMappings: NotionPropertyMapping[];
};

const MANAGED_MEETING_UPLOAD_SEMANTIC_KEYS = [
  "meeting.title",
  "meeting.date",
  "meeting.time",
  "meeting.channel",
  "meeting.memberRelation",
  "meeting.participants",
  "meeting.actionItems",
  "meeting.status",
  "meeting.sessionId",
  "meeting.draftId",
  "meeting.contentHash",
  "meeting.localStatus",
] as const satisfies readonly NotionPropertySemanticKey[];

const MANAGED_MEMBER_UPLOAD_SEMANTIC_KEYS = [
  "member.discordName",
] as const satisfies readonly NotionPropertySemanticKey[];

const MANAGED_TASK_UPLOAD_SEMANTIC_KEYS = [
  "task.title",
  "task.meeting",
  "task.workerRelation",
  "task.assignee",
  "task.role",
  "task.dueDate",
  "task.status",
  "task.evidence",
  "task.sourceActionId",
] as const satisfies readonly NotionPropertySemanticKey[];

export async function resolveUploadTarget(input: {
  client: NotionClient;
  settings: NotionRuntimeSettings;
  registryStore: NotionRegistryStore | null;
  baseResult: NotionUploadResult;
}): Promise<
  | { ok: true; target: ResolvedTarget }
  | { ok: false; result: NotionUploadResult }
> {
  const registryBlock = blockPartialManagedNotionRegistry(input.registryStore, {
    includeDatabases: true,
  });
  if (registryBlock) {
    return {
      ok: false,
      result: {
        ...input.baseResult,
        status: "blocked",
        message: registryBlock.message,
        userAction: registryBlock.userAction,
        technicalDetail: registryBlock.technicalDetail,
      },
    };
  }

  const managedCandidate = loadManagedUploadRegistryCandidate(input.registryStore);
  if (managedCandidate) {
    return await resolveManagedUploadTarget({
      client: input.client,
      candidate: managedCandidate,
      baseResult: input.baseResult,
    });
  }

  if (!input.settings.targetUrl) {
    return {
      ok: false,
      result: {
        ...input.baseResult,
        status: "not_configured",
        message: "Notion target is not configured.",
        userAction:
          "설정 화면에서 managed Notion DB를 생성하거나 업로드 대상을 다시 연결해 주세요.",
      },
    };
  }

  const parsedTarget = parseNotionTargetUrl(input.settings.targetUrl);
  if (parsedTarget.kind === "invalid") {
    return {
      ok: false,
      result: {
        ...input.baseResult,
        status: "not_configured",
        message: "Notion target URL is invalid.",
        userAction:
          "Notion 데이터베이스 또는 data source URL을 다시 복사해 붙여넣어 주세요.",
        technicalDetail: parsedTarget.reason,
      },
    };
  }

  const target = await resolveTarget(input.client, parsedTarget);
  const schemaValidation = validateNotionDataSourceSchema(
    readDataSourceProperties(target.dataSource),
    input.settings.propertyNames,
  );
  if (!schemaValidation.ok) {
    return {
      ok: false,
      result: {
        ...input.baseResult,
        status: "blocked",
        targetId: target.id,
        targetName: target.name,
        message: "Notion data source schema is not compatible.",
        userAction: schemaValidation.userAction,
        technicalDetail: JSON.stringify({
          missing: schemaValidation.missing,
          wrongType: schemaValidation.wrongType,
          missingOptions: schemaValidation.missingOptions,
        }),
      },
    };
  }

  return {
    ok: true,
    target: {
      ...target,
      kind: "legacy",
      url: input.settings.targetUrl,
      propertyIds: schemaValidation.propertyIds,
      propertyNames: input.settings.propertyNames,
      draftIdPropertyName: input.settings.propertyNames.draftId,
      sessionIdPropertyName: input.settings.propertyNames.sessionId,
    },
  };
}

async function resolveManagedUploadTarget(input: {
  client: NotionClient;
  candidate: ManagedUploadRegistryCandidate;
  baseResult: NotionUploadResult;
}): Promise<
  | { ok: true; target: ManagedResolvedTarget }
  | { ok: false; result: NotionUploadResult }
> {
  const meetingDataSource = await input.client.retrieveDataSource(
    input.candidate.meetingDatabase.dataSourceId,
  );
  const meetingValidation = validateManagedDataSourceSchemaForUpload({
    databaseRole: "meeting",
    properties: readDataSourceProperties(meetingDataSource),
    mappings: input.candidate.allMappings,
    managedDatabases: input.candidate.managedDatabases,
    requiredSemanticKeys: MANAGED_MEETING_UPLOAD_SEMANTIC_KEYS,
  });
  if (!meetingValidation.ok) {
    return {
      ok: false,
      result: {
        ...input.baseResult,
        status: "blocked",
        targetId: input.candidate.meetingDatabase.dataSourceId,
        targetName: input.candidate.meetingDatabase.name,
        message: "Managed Notion meeting DB schema is not compatible.",
        userAction: meetingValidation.userAction,
        technicalDetail: JSON.stringify({
          missing: meetingValidation.missing,
          wrongType: meetingValidation.wrongType,
          missingOptions: meetingValidation.missingOptions,
        }),
      },
    };
  }

  const memberDataSource = await input.client.retrieveDataSource(
    input.candidate.memberDatabase.dataSourceId,
  );
  const memberValidation = validateManagedDataSourceSchemaForUpload({
    databaseRole: "member",
    properties: readDataSourceProperties(memberDataSource),
    mappings: input.candidate.allMappings,
    managedDatabases: input.candidate.managedDatabases,
    requiredSemanticKeys: MANAGED_MEMBER_UPLOAD_SEMANTIC_KEYS,
  });
  if (!memberValidation.ok) {
    return {
      ok: false,
      result: {
        ...input.baseResult,
        status: "blocked",
        targetId: input.candidate.memberDatabase.dataSourceId,
        targetName: input.candidate.memberDatabase.name,
        message: "Managed Notion member DB schema is not compatible.",
        userAction: memberValidation.userAction,
        technicalDetail: JSON.stringify({
          missing: memberValidation.missing,
          wrongType: memberValidation.wrongType,
          missingOptions: memberValidation.missingOptions,
        }),
      },
    };
  }

  const draftId = requireSemanticResolvedProperty(
    meetingValidation.propertyIds,
    "meeting.draftId",
  );
  const sessionId = requireSemanticResolvedProperty(
    meetingValidation.propertyIds,
    "meeting.sessionId",
  );
  const actionItems = await resolveManagedActionItemTarget({
    client: input.client,
    candidate: input.candidate,
  });
  return {
    ok: true,
    target: {
      kind: "managed",
      id: input.candidate.meetingDatabase.dataSourceId,
      name: readTargetName(meetingDataSource) || input.candidate.meetingDatabase.name,
      url: input.candidate.meetingDatabase.url,
      dataSource: meetingDataSource,
      draftIdPropertyName: draftId.name,
      sessionIdPropertyName: sessionId.name,
      meetingDatabase: input.candidate.meetingDatabase,
      memberDatabase: input.candidate.memberDatabase,
      meetingProperties: meetingValidation.propertyIds,
      memberDiscordNameProperty: requireSemanticResolvedProperty(
        memberValidation.propertyIds,
        "member.discordName",
      ),
      actionItemTarget: actionItems.target,
      actionItemWarnings: actionItems.warnings,
    },
  };
}

async function resolveManagedActionItemTarget(input: {
  client: NotionClient;
  candidate: ManagedUploadRegistryCandidate;
}): Promise<{
  target: ManagedResolvedTarget["actionItemTarget"];
  warnings: string[];
}> {
  const warnings: string[] = [];
  if (!input.candidate.taskDatabase) {
    return {
      target: null,
      warnings: ["Notion 할 일 목록 DB 연결 정보가 없어 할 일 페이지 생성을 건너뜁니다."],
    };
  }

  try {
    const taskDataSource = await input.client.retrieveDataSource(
      input.candidate.taskDatabase.dataSourceId,
    );
    const taskValidation = validateManagedDataSourceSchemaForUpload({
      databaseRole: "task",
      properties: readDataSourceProperties(taskDataSource),
      mappings: input.candidate.allMappings,
      managedDatabases: input.candidate.managedDatabases,
      requiredSemanticKeys: MANAGED_TASK_UPLOAD_SEMANTIC_KEYS,
    });
    if (!taskValidation.ok) {
      return {
        target: null,
        warnings: [
          `Notion 할 일 목록 DB 스키마가 건강하지 않아 할 일 페이지 생성을 건너뜁니다. ${taskValidation.userAction}`,
        ],
      };
    }
    return {
      target: {
        database: input.candidate.taskDatabase,
        properties: taskValidation.propertyIds,
      },
      warnings,
    };
  } catch (error) {
    return {
      target: null,
      warnings: [
        `Notion 할 일 목록 DB 상태를 확인하지 못해 할 일 페이지 생성을 건너뜁니다 (${error instanceof Error ? error.message : String(error)}).`,
      ],
    };
  }
}

function loadManagedUploadRegistryCandidate(
  registryStore: NotionRegistryStore | null,
): ManagedUploadRegistryCandidate | null {
  if (!registryStore) {
    return null;
  }

  const meetingDatabase = registryStore.getManagedDatabase("meeting");
  const memberDatabase = registryStore.getManagedDatabase("member");
  const taskDatabase = registryStore.getManagedDatabase("task");
  if (!meetingDatabase || !memberDatabase) {
    return null;
  }

  const managedDatabases = registryStore.listManagedDatabases();
  const allMappings = registryStore.listPropertyMappings();
  const meetingMappings = registryStore.listPropertyMappings("meeting");
  const memberMappings = registryStore.listPropertyMappings("member");
  if (
    !hasRequiredMappings(meetingMappings, MANAGED_MEETING_UPLOAD_SEMANTIC_KEYS) ||
    !hasRequiredMappings(memberMappings, MANAGED_MEMBER_UPLOAD_SEMANTIC_KEYS)
  ) {
    return null;
  }

  return {
    meetingDatabase,
    memberDatabase,
    taskDatabase,
    managedDatabases,
    allMappings,
    meetingMappings,
    memberMappings,
  };
}

function hasRequiredMappings(
  mappings: readonly NotionPropertyMapping[],
  requiredSemanticKeys: readonly NotionPropertySemanticKey[],
): boolean {
  const keys = new Set(mappings.map((mapping) => mapping.semanticKey));
  return requiredSemanticKeys.every((semanticKey) => keys.has(semanticKey));
}

function requireSemanticResolvedProperty(
  properties: NotionSemanticResolvedProperties,
  semanticKey: NotionPropertySemanticKey,
): NotionSemanticResolvedProperty {
  const property = properties[semanticKey];
  if (!property) {
    throw new Error(`Managed Notion mapping is missing: ${semanticKey}`);
  }
  return property;
}

export async function resolveTarget(
  client: NotionClient,
  parsedTarget: Exclude<ReturnType<typeof parseNotionTargetUrl>, { kind: "invalid" }>,
): Promise<RemoteResolvedTarget> {
  if (parsedTarget.kind === "data_source_id") {
    const dataSource = await client.retrieveDataSource(parsedTarget.id);
    return {
      id: parsedTarget.id,
      name: readTargetName(dataSource),
      dataSource,
    };
  }

  const database = await client.retrieveDatabase(parsedTarget.id);
  const dataSources = readDataSources(database);
  if (dataSources.length !== 1) {
    throw createWriterValidationError(
      "Notion database must contain exactly one child data source.",
      "Notion database에 data source가 여러 개이면 업로드할 data source URL을 직접 복사해 주세요.",
      `child data source count: ${dataSources.length}`,
    );
  }
  const dataSourceId = readId(dataSources[0]);
  if (!dataSourceId) {
    throw createWriterValidationError(
      "Notion data source id is missing.",
      "Notion data source URL을 다시 복사해 붙여넣어 주세요.",
      "database child data source id missing",
    );
  }
  const dataSource = await client.retrieveDataSource(dataSourceId);
  return {
    id: dataSourceId,
    name: readTargetName(dataSource),
    dataSource,
  };
}

