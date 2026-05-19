import type { NotionClient } from "./client.js";
import { formatLocaleText, t } from "../i18n/catalog.js";
import type { DirongLocale } from "../settings/local-settings-store.js";
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
  projectId?: string | null;
  baseResult: NotionUploadResult;
  signal?: AbortSignal;
  locale?: DirongLocale;
}): Promise<
  | { ok: true; target: ResolvedTarget }
  | { ok: false; result: NotionUploadResult }
> {
  const locale = input.locale ?? "ko";
  const registryBlock = blockPartialManagedNotionRegistry(input.registryStore, {
    includeDatabases: true,
    projectId: input.projectId,
    locale,
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

  const managedCandidate = loadManagedUploadRegistryCandidate(
    input.registryStore,
    input.projectId,
  );
  if (managedCandidate) {
    return await resolveManagedUploadTarget({
      client: input.client,
      candidate: managedCandidate,
      baseResult: input.baseResult,
      signal: input.signal,
      locale,
    });
  }

  if (!input.settings.targetUrl) {
    return {
      ok: false,
      result: {
        ...input.baseResult,
        status: "not_configured",
        message: t(locale, "notionDashboardService.uploadTarget.targetMissingMessage"),
        userAction: t(locale, "notionDashboardService.uploadTarget.targetMissingAction"),
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
        message: t(locale, "notionDashboardService.uploadTarget.targetInvalidMessage"),
        userAction: t(locale, "notionDashboardService.uploadTarget.targetInvalidAction"),
        technicalDetail: parsedTarget.reason,
      },
    };
  }

  const target = await resolveTarget(input.client, parsedTarget, input.signal, locale);
  const schemaValidation = validateNotionDataSourceSchema(
    readDataSourceProperties(target.dataSource),
    input.settings.propertyNames,
    locale,
  );
  if (!schemaValidation.ok) {
    return {
      ok: false,
      result: {
        ...input.baseResult,
        status: "blocked",
        targetId: target.id,
        targetName: target.name,
        message: t(
          locale,
          "notionDashboardService.uploadTarget.legacySchemaIncompatibleMessage",
        ),
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
  signal?: AbortSignal;
  locale: DirongLocale;
}): Promise<
  | { ok: true; target: ManagedResolvedTarget }
  | { ok: false; result: NotionUploadResult }
> {
  const meetingDataSource = await input.client.retrieveDataSource(
    input.candidate.meetingDatabase.dataSourceId,
    { signal: input.signal },
  );
  const meetingValidation = validateManagedDataSourceSchemaForUpload({
    databaseRole: "meeting",
    properties: readDataSourceProperties(meetingDataSource),
    mappings: input.candidate.allMappings,
    managedDatabases: input.candidate.managedDatabases,
    requiredSemanticKeys: MANAGED_MEETING_UPLOAD_SEMANTIC_KEYS,
    locale: input.locale,
  });
  if (!meetingValidation.ok) {
    return {
      ok: false,
      result: {
        ...input.baseResult,
        status: "blocked",
        targetId: input.candidate.meetingDatabase.dataSourceId,
        targetName: input.candidate.meetingDatabase.name,
        message: t(
          input.locale,
          "notionDashboardService.uploadTarget.managedMeetingSchemaIncompatibleMessage",
        ),
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
    { signal: input.signal },
  );
  const memberValidation = validateManagedDataSourceSchemaForUpload({
    databaseRole: "member",
    properties: readDataSourceProperties(memberDataSource),
    mappings: input.candidate.allMappings,
    managedDatabases: input.candidate.managedDatabases,
    requiredSemanticKeys: MANAGED_MEMBER_UPLOAD_SEMANTIC_KEYS,
    locale: input.locale,
  });
  if (!memberValidation.ok) {
    return {
      ok: false,
      result: {
        ...input.baseResult,
        status: "blocked",
        targetId: input.candidate.memberDatabase.dataSourceId,
        targetName: input.candidate.memberDatabase.name,
        message: t(
          input.locale,
          "notionDashboardService.uploadTarget.managedMemberSchemaIncompatibleMessage",
        ),
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
    signal: input.signal,
    locale: input.locale,
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
  signal?: AbortSignal;
  locale: DirongLocale;
}): Promise<{
  target: ManagedResolvedTarget["actionItemTarget"];
  warnings: string[];
}> {
  const warnings: string[] = [];
  if (!input.candidate.taskDatabase) {
    return {
      target: null,
      warnings: [t(input.locale, "notionDashboardService.uploadTarget.taskDbMissingWarning")],
    };
  }

  try {
    const taskDataSource = await input.client.retrieveDataSource(
      input.candidate.taskDatabase.dataSourceId,
      { signal: input.signal },
    );
    const taskValidation = validateManagedDataSourceSchemaForUpload({
      databaseRole: "task",
      properties: readDataSourceProperties(taskDataSource),
      mappings: input.candidate.allMappings,
      managedDatabases: input.candidate.managedDatabases,
      requiredSemanticKeys: MANAGED_TASK_UPLOAD_SEMANTIC_KEYS,
      locale: input.locale,
    });
    if (!taskValidation.ok) {
      return {
        target: null,
        warnings: [
          formatLocaleText(
            input.locale,
            "notionDashboardService.uploadTarget.taskDbUnhealthyWarning",
            { action: taskValidation.userAction },
          ),
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
    if (input.signal?.aborted) {
      throw error;
    }
    return {
      target: null,
      warnings: [
        formatLocaleText(
          input.locale,
          "notionDashboardService.uploadTarget.taskDbCheckFailedWarning",
          { error: error instanceof Error ? error.message : String(error) },
        ),
      ],
    };
  }
}

function loadManagedUploadRegistryCandidate(
  registryStore: NotionRegistryStore | null,
  projectId: string | null | undefined,
): ManagedUploadRegistryCandidate | null {
  if (!registryStore || projectId === null) {
    return null;
  }

  const meetingDatabase = registryStore.getManagedDatabase("meeting", projectId);
  const memberDatabase = registryStore.getManagedDatabase("member", projectId);
  const taskDatabase = registryStore.getManagedDatabase("task", projectId);
  if (!meetingDatabase || !memberDatabase) {
    return null;
  }

  const managedDatabases = registryStore.listManagedDatabases(projectId);
  const allMappings = registryStore.listPropertyMappings(undefined, projectId);
  const meetingMappings = registryStore.listPropertyMappings("meeting", projectId);
  const memberMappings = registryStore.listPropertyMappings("member", projectId);
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
  signal?: AbortSignal,
  locale: DirongLocale = "ko",
): Promise<RemoteResolvedTarget> {
  if (parsedTarget.kind === "data_source_id") {
    const dataSource = await client.retrieveDataSource(parsedTarget.id, { signal });
    return {
      id: parsedTarget.id,
      name: readTargetName(dataSource),
      dataSource,
    };
  }

  const database = await client.retrieveDatabase(parsedTarget.id, { signal });
  const dataSources = readDataSources(database);
  if (dataSources.length !== 1) {
    throw createWriterValidationError(
      "Notion database must contain exactly one child data source.",
      t(locale, "notionDashboardService.uploadTarget.multipleDataSourcesAction"),
      `child data source count: ${dataSources.length}`,
    );
  }
  const dataSourceId = readId(dataSources[0]);
  if (!dataSourceId) {
    throw createWriterValidationError(
      "Notion data source id is missing.",
      t(locale, "notionDashboardService.uploadTarget.dataSourceIdMissingAction"),
      "database child data source id missing",
    );
  }
  const dataSource = await client.retrieveDataSource(dataSourceId, { signal });
  return {
    id: dataSourceId,
    name: readTargetName(dataSource),
    dataSource,
  };
}

