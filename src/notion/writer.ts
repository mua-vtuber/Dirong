import {
  type NotionApiError,
  type NotionClient,
  NotionApiError as NotionApiErrorClass,
} from "./client.js";
import { renderNotionBlocks, extractPlainTextFromBlock } from "./blocks.js";
import type { RenderedNotionBlock, NotionBlockPayload } from "./blocks.js";
import { computeNotionContentHash } from "./content-hash.js";
import { NotionDraftInputReadModel } from "./draft-input-read-model.js";
import type { NotionDraftInput } from "./draft-input.js";
import {
  buildNotionPagePropertyValues,
  richText,
  renderNotionPagePropertiesFromSemanticMappings,
  renderNotionPageProperties,
  sanitizeParticipantNames,
  type NotionParticipantsPropertyType,
  type NotionStatusPropertyType,
} from "./page-properties.js";
import type { NotionCustomPropertyRule } from "./property-rules.js";
import {
  validateNotionDataSourceSchema,
  validateNotionDataSourceSchemaBySemanticKey,
} from "./schema.js";
import type {
  NotionResolvedPropertyIds,
  NotionSemanticResolvedProperties,
  NotionSemanticResolvedProperty,
} from "./schema.js";
import type {
  NotionPropertySemanticKey,
} from "./schema-presets.js";
import type { NotionRuntimeSettings } from "./settings.js";
import {
  normalizeNotionId,
  parseNotionPageUrl,
  parseNotionTargetUrl,
} from "./target.js";
import {
  NotionRegistryStore,
  type NotionManagedDatabase,
  type NotionPropertyMapping,
} from "./registry-store.js";
import {
  readDataSourceProperties,
  readDataSources,
  readId,
  readResults,
} from "./data-source-readers.js";
import {
  blockPartialManagedNotionRegistry,
  hasCompleteManagedNotionUploadRegistry,
} from "./managed-registry-policy.js";
import { NotionWriteStore, type NotionWriteRow } from "./write-store.js";

export type NotionDraftSelector =
  | { kind: "draft"; draftId: string }
  | { kind: "session"; sessionId: string };

export type NotionUploadStatus =
  | "disabled"
  | "not_configured"
  | "draft_not_found"
  | "dry_run"
  | "done"
  | "not_claimed"
  | "retry_wait"
  | "blocked"
  | "failed";

export type NotionUploadResult = {
  status: NotionUploadStatus;
  dbChanged: boolean;
  dryRun: boolean;
  sessionId: string | null;
  draftId: string | null;
  targetId: string | null;
  targetName: string | null;
  writeId: string | null;
  pageId: string | null;
  pageUrl: string | null;
  contentHash: string | null;
  blockCount: number;
  message: string;
  userAction: string | null;
  technicalDetail: string | null;
  warnings: string[];
};

export type RunNotionUploadOptions = {
  settings: NotionRuntimeSettings;
  selector: NotionDraftSelector;
  dryRun: boolean;
  force: boolean;
  workerId: string;
  leaseMs: number;
  nowIso?: string;
  client: NotionClient | null;
  readModel: NotionDraftInputReadModel;
  writeStore: NotionWriteStore | null;
  registryStore?: NotionRegistryStore | null;
  customPropertyRules?: readonly NotionCustomPropertyRule[];
};

type ResolvedTargetBase = {
  id: string;
  name: string;
  url: string;
  dataSource: Record<string, unknown>;
  draftIdPropertyName: string;
  sessionIdPropertyName: string;
};

type RemoteResolvedTarget = {
  id: string;
  name: string;
  dataSource: Record<string, unknown>;
};

type LegacyResolvedTarget = ResolvedTargetBase & {
  kind: "legacy";
  propertyIds: NotionResolvedPropertyIds;
  propertyNames: NotionRuntimeSettings["propertyNames"];
};

type ManagedResolvedTarget = ResolvedTargetBase & {
  kind: "managed";
  meetingDatabase: NotionManagedDatabase;
  memberDatabase: NotionManagedDatabase;
  meetingProperties: NotionSemanticResolvedProperties;
  memberDiscordNameProperty: NotionSemanticResolvedProperty;
};

type ResolvedTarget = LegacyResolvedTarget | ManagedResolvedTarget;

type ManagedUploadRegistryCandidate = {
  meetingDatabase: NotionManagedDatabase;
  memberDatabase: NotionManagedDatabase;
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

export async function runNotionUpload(
  options: RunNotionUploadOptions,
): Promise<NotionUploadResult> {
  const nowIso = options.nowIso ?? new Date().toISOString();
  const baseResult = createBaseResult(options.dryRun);

  if (!options.settings.enabled) {
    return {
      ...baseResult,
      status: "disabled",
      message: "Notion export is disabled.",
    };
  }

  if (!options.settings.apiKey) {
    return {
      ...baseResult,
      status: "not_configured",
      message: "Notion settings are incomplete.",
      userAction:
        "Notion 업로드를 켜려면 NOTION_API_KEY를 설정해 주세요.",
    };
  }

  if (!options.client) {
    return {
      ...baseResult,
      status: "not_configured",
      message: "Notion client is not available.",
      userAction: "Notion API key 설정을 확인해 주세요.",
    };
  }

  try {
    const targetResolution = await resolveUploadTarget({
      client: options.client,
      settings: options.settings,
      registryStore: options.registryStore ?? null,
      baseResult,
    });
    if (!targetResolution.ok) {
      return targetResolution.result;
    }
    const target = targetResolution.target;

    const draftInput = loadDraftInput(options.readModel, options.selector);
    if (!draftInput) {
      return {
        ...baseResult,
        status: "draft_not_found",
        targetId: target.id,
        targetName: target.name,
        message: "No valid meeting notes draft was found.",
        userAction: "Phase 4 AI cleanup을 먼저 완료한 뒤 다시 시도해 주세요.",
      };
    }

    const memberRelations =
      target.kind === "managed"
        ? await resolveManagedMemberRelations({
            client: options.client,
            draftInput,
            target,
          })
        : { pageIds: [], warnings: [] };

    const renderPlan = renderUploadPlan({
      draftInput,
      targetId: target.id,
      target,
      memberRelationPageIds: memberRelations.pageIds,
      extraWarnings: memberRelations.warnings,
    });

    if (options.dryRun) {
      return {
        ...baseResult,
        status: "dry_run",
        sessionId: draftInput.session.id,
        draftId: draftInput.draft.id,
        targetId: target.id,
        targetName: target.name,
        contentHash: renderPlan.contentHash,
        blockCount: renderPlan.blocks.length,
        message: "Dry-run rendered Notion payload without writing SQLite or Notion pages.",
        warnings: renderPlan.warnings,
      };
    }

    if (!options.writeStore) {
      return {
        ...baseResult,
        status: "failed",
        message: "Notion write store is not available.",
      };
    }

    return await executeWrite({
      options,
      nowIso,
      target,
      draftInput,
      renderPlan,
    });
  } catch (error) {
    if (error instanceof NotionApiErrorClass) {
      return resultFromNotionError(baseResult, error);
    }
    throw error;
  }
}

function renderUploadPlan(input: {
  draftInput: NotionDraftInput;
  targetId: string;
  target: ResolvedTarget;
  memberRelationPageIds: readonly string[];
  extraWarnings: readonly string[];
}): {
  contentHash: string;
  blocks: RenderedNotionBlock[];
  properties: Record<string, unknown>;
  doneProperties: Record<string, unknown>;
  warnings: string[];
} {
  const propertyValues = buildNotionPagePropertyValues({
    draftInput: input.draftInput,
  });
  const hashBlocks = renderNotionBlocks(input.draftInput);
  const contentHash = computeNotionContentHash({
    draftId: input.draftInput.draft.id,
    draftOutputHash: input.draftInput.draft.output_hash,
    sessionId: input.draftInput.session.id,
    targetDataSourceId: input.targetId,
    propertyValues: propertyValues.values,
    renderedBlocks: hashBlocks.map((block) => block.block),
  });
  const blocks = renderNotionBlocks(input.draftInput, { contentHash });
  const properties =
    input.target.kind === "managed"
      ? renderNotionPagePropertiesFromSemanticMappings({
          draftInput: input.draftInput,
          propertiesBySemanticKey: input.target.meetingProperties,
          contentHash,
          status: "draft",
          localStatus: "Notion upload in progress",
          memberRelationPageIds: input.memberRelationPageIds,
        }).properties
      : renderNotionPageProperties({
          draftInput: input.draftInput,
          propertyNames: input.target.propertyNames,
          contentHash,
          status: "draft",
          statusPropertyType: readStatusPropertyType(
            input.target.propertyIds.status.type,
          ),
          participantsPropertyType: readParticipantsPropertyType(
            input.target.propertyIds.participants.type,
          ),
          localStatus: "Notion upload in progress",
        }).properties;
  const doneProperties =
    input.target.kind === "managed"
      ? renderNotionPagePropertiesFromSemanticMappings({
          draftInput: input.draftInput,
          propertiesBySemanticKey: input.target.meetingProperties,
          contentHash,
          status: "done",
          localStatus: "Notion upload complete",
          memberRelationPageIds: input.memberRelationPageIds,
        }).properties
      : renderNotionPageProperties({
          draftInput: input.draftInput,
          propertyNames: input.target.propertyNames,
          contentHash,
          status: "done",
          statusPropertyType: readStatusPropertyType(
            input.target.propertyIds.status.type,
          ),
          participantsPropertyType: readParticipantsPropertyType(
            input.target.propertyIds.participants.type,
          ),
          localStatus: "Notion upload complete",
        }).properties;

  return {
    contentHash,
    blocks,
    warnings: [...propertyValues.warnings, ...input.extraWarnings],
    properties,
    doneProperties,
  };
}

function readStatusPropertyType(type: string): NotionStatusPropertyType {
  return type === "status" ? "status" : "select";
}

function readParticipantsPropertyType(type: string): NotionParticipantsPropertyType {
  return type === "rollup" ? "rollup" : "multi_select";
}

async function resolveUploadTarget(input: {
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
          "managed Notion DB를 생성하거나 전환기 fallback용 NOTION_TARGET_URL을 설정해 주세요.",
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
  const meetingValidation = validateNotionDataSourceSchemaBySemanticKey({
    databaseRole: "meeting",
    properties: readDataSourceProperties(meetingDataSource),
    mappings: input.candidate.meetingMappings,
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
  const memberValidation = validateNotionDataSourceSchemaBySemanticKey({
    databaseRole: "member",
    properties: readDataSourceProperties(memberDataSource),
    mappings: input.candidate.memberMappings,
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
    },
  };
}

function loadManagedUploadRegistryCandidate(
  registryStore: NotionRegistryStore | null,
): ManagedUploadRegistryCandidate | null {
  if (!registryStore) {
    return null;
  }

  const meetingDatabase = registryStore.getManagedDatabase("meeting");
  const memberDatabase = registryStore.getManagedDatabase("member");
  if (!meetingDatabase || !memberDatabase) {
    return null;
  }

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

async function executeWrite(input: {
  options: RunNotionUploadOptions;
  nowIso: string;
  target: ResolvedTarget;
  draftInput: NotionDraftInput;
  renderPlan: ReturnType<typeof renderUploadPlan>;
}): Promise<NotionUploadResult> {
  const { options, nowIso, target, draftInput, renderPlan } = input;
  const writeStore = options.writeStore;
  if (!writeStore) {
    throw new Error("Notion write store is required.");
  }

  const write = writeStore.createOrGetWrite({
    sessionId: draftInput.session.id,
    draftId: draftInput.draft.id,
    targetType: "data_source",
    targetId: target.id,
    targetUrl: target.url,
    contentHash: renderPlan.contentHash,
    maxAttempts: options.settings.maxAttempts,
    nowIso,
  });

  if (write.status === "done" && !options.force) {
    return doneResult({
      dryRun: false,
      draftInput,
      target,
      write,
      contentHash: renderPlan.contentHash,
      blockCount: renderPlan.blocks.length,
      dbChanged: false,
      message: "Notion write is already done.",
      warnings: renderPlan.warnings,
    });
  }

  const claimed = writeStore.claimWrite(write.id, options.workerId, options.leaseMs, {
    force: options.force,
  });
  if (!claimed) {
    const latest = writeStore.getWrite(write.id) ?? write;
    return {
      ...createBaseResult(false),
      status: "not_claimed",
      sessionId: draftInput.session.id,
      draftId: draftInput.draft.id,
      targetId: target.id,
      targetName: target.name,
      writeId: latest.id,
      pageId: latest.notion_page_id,
      pageUrl: latest.notion_page_url,
      contentHash: latest.content_hash,
      blockCount: renderPlan.blocks.length,
      message: "Notion write is already processing or waiting for retry.",
    };
  }

  try {
    const customProperties = await renderNotionCustomPageProperties({
      client: options.client,
      draftInput,
      rules: options.customPropertyRules ?? [],
    });
    const page = await ensurePage({
      client: options.client,
      writeStore,
      write: claimed,
      target,
      draftInput,
      properties: { ...renderPlan.properties, ...customProperties },
      propertyDraftIdName: target.draftIdPropertyName,
      propertySessionIdName: target.sessionIdPropertyName,
      nowIso,
    });
    await recoverRemoteBlocks({
      client: options.client,
      writeStore,
      writeId: claimed.id,
      pageId: page.id,
      blocks: renderPlan.blocks,
      nowIso,
    });
    await appendRemainingBlocks({
      client: options.client,
      writeStore,
      writeId: claimed.id,
      pageId: page.id,
      blocks: renderPlan.blocks,
      nowIso,
    });
    await options.client?.updatePage(page.id, {
      properties: { ...renderPlan.doneProperties, ...customProperties },
    });
    writeStore.markDone({
      id: claimed.id,
      statusMessage: "Notion upload complete",
      nowIso,
    });

    const done = writeStore.getWrite(claimed.id) ?? claimed;
    return doneResult({
      dryRun: false,
      draftInput,
      target,
      write: done,
      contentHash: renderPlan.contentHash,
      blockCount: renderPlan.blocks.length,
      dbChanged: true,
      message: "Notion upload complete.",
      warnings: renderPlan.warnings,
    });
  } catch (error) {
    if (error instanceof NotionApiErrorClass) {
      return persistNotionError({
        error,
        writeStore,
        writeId: claimed.id,
        nowIso,
        draftInput,
        target,
        contentHash: renderPlan.contentHash,
        blockCount: renderPlan.blocks.length,
      });
    }
    throw error;
  }
}

async function ensurePage(input: {
  client: NotionClient | null;
  writeStore: NotionWriteStore;
  write: NotionWriteRow;
  target: ResolvedTarget;
  draftInput: NotionDraftInput;
  properties: Record<string, unknown>;
  propertyDraftIdName: string;
  propertySessionIdName: string;
  nowIso: string;
}): Promise<{ id: string; url: string | null }> {
  if (!input.client) {
    throw new Error("Notion client is required.");
  }
  if (input.write.notion_page_id) {
    return {
      id: input.write.notion_page_id,
      url: input.write.notion_page_url,
    };
  }

  const existing = await input.client.queryDataSource(input.target.id, {
    filter: {
      property: input.propertyDraftIdName,
      rich_text: { equals: input.draftInput.draft.id },
    },
    page_size: 2,
  });
  const results = readResults(existing);
  if (results.length > 1) {
    throw createWriterValidationError(
      "Multiple Notion pages have the same Draft ID.",
      "Notion 데이터베이스에서 같은 Draft ID를 가진 page를 하나만 남긴 뒤 다시 시도해 주세요.",
      "duplicate remote Draft ID",
    );
  }
  if (results.length === 1) {
    const page = readPageRef(results[0]);
    input.writeStore.savePageCreated({
      id: input.write.id,
      pageId: page.id,
      pageUrl: page.url ?? "",
      nowIso: input.nowIso,
    });
    return page;
  }

  const existingBySession = await input.client.queryDataSource(input.target.id, {
    filter: {
      property: input.propertySessionIdName,
      rich_text: { equals: input.draftInput.session.id },
    },
    page_size: 2,
  });
  const sessionResults = readResults(existingBySession);
  if (sessionResults.length > 1) {
    throw createWriterValidationError(
      "Multiple Notion pages have the same Session ID.",
      "Notion 데이터베이스에서 같은 Session ID를 가진 page를 하나만 남긴 뒤 다시 시도해 주세요.",
      "duplicate remote Session ID",
    );
  }
  if (sessionResults.length === 1) {
    const page = readPageRef(sessionResults[0]);
    input.writeStore.savePageCreated({
      id: input.write.id,
      pageId: page.id,
      pageUrl: page.url ?? "",
      nowIso: input.nowIso,
    });
    return page;
  }

  const created = await input.client.createPage({
    parent: { data_source_id: input.target.id },
    properties: input.properties,
  });
  const page = readPageRef(created);
  input.writeStore.savePageCreated({
    id: input.write.id,
    pageId: page.id,
    pageUrl: page.url ?? "",
    nowIso: input.nowIso,
  });
  return page;
}

async function renderNotionCustomPageProperties(input: {
  client: NotionClient | null;
  draftInput: NotionDraftInput;
  rules: readonly NotionCustomPropertyRule[];
}): Promise<Record<string, unknown>> {
  const properties: Record<string, unknown> = {};
  const enabledRules = input.rules.filter((rule) => rule.enabled);
  if (enabledRules.length === 0) {
    return properties;
  }

  for (const rule of enabledRules) {
    const values = readCustomPropertyValues(input.draftInput, rule);

    if (rule.propertyType === "relation") {
      const relation = await renderRelationProperty({
        client: input.client,
        rule,
        values,
      });
      if (relation.length > 0) {
        properties[rule.propertyName] = { relation };
      }
      continue;
    }

    if (values.length === 0) {
      continue;
    }
    if (rule.propertyType === "rich_text") {
      properties[rule.propertyName] = {
        rich_text: richText(values.join("\n").slice(0, rule.maxLength)),
      };
      continue;
    }
    if (rule.propertyType === "select") {
      properties[rule.propertyName] = { select: { name: values[0] } };
      continue;
    }
    if (rule.propertyType === "multi_select") {
      properties[rule.propertyName] = {
        multi_select: values.slice(0, 100).map((name) => ({ name })),
      };
      continue;
    }
    if (rule.propertyType === "checkbox") {
      properties[rule.propertyName] = {
        checkbox: readCheckboxValue(values[0] ?? ""),
      };
      continue;
    }
    if (rule.propertyType === "date") {
      const date = readDateValue(values[0] ?? "");
      if (date) {
        properties[rule.propertyName] = { date: { start: date } };
      }
      continue;
    }
  }

  return properties;
}

async function resolveManagedMemberRelations(input: {
  client: NotionClient | null;
  draftInput: NotionDraftInput;
  target: ManagedResolvedTarget;
}): Promise<{ pageIds: string[]; warnings: string[] }> {
  const warnings: string[] = [];
  if (!input.client) {
    return { pageIds: [], warnings };
  }

  const participants = buildNotionPagePropertyValues({
    draftInput: input.draftInput,
  });

  const pageIds: string[] = [];
  const seenPageIds = new Set<string>();
  for (const name of participants.values.participants) {
    const pageId = await findManagedMemberPageByDiscordName({
      client: input.client,
      target: input.target,
      name,
    });
    if (!pageId) {
      warnings.push(
        `Notion 작업자 DB에서 Discord 참가자 "${name}"를 찾지 못해 참가자 relation에서 제외했습니다.`,
      );
      continue;
    }
    if (seenPageIds.has(pageId)) {
      continue;
    }
    seenPageIds.add(pageId);
    pageIds.push(pageId);
  }

  return { pageIds, warnings };
}

async function findManagedMemberPageByDiscordName(input: {
  client: NotionClient;
  target: ManagedResolvedTarget;
  name: string;
}): Promise<string | null> {
  const filter = buildManagedMemberMatchFilter(
    input.target.memberDiscordNameProperty,
    input.name,
  );
  if (!filter) {
    return null;
  }

  const existing = await input.client.queryDataSource(
    input.target.memberDatabase.dataSourceId,
    {
      filter,
      page_size: 2,
    },
  );
  const results = readResults(existing);
  return results.length === 1 ? readId(results[0]) : null;
}

function buildManagedMemberMatchFilter(
  property: NotionSemanticResolvedProperty,
  value: string,
): Record<string, unknown> | null {
  if (property.type === "title") {
    return {
      property: property.name,
      title: { equals: value },
    };
  }
  if (property.type === "rich_text") {
    return {
      property: property.name,
      rich_text: { equals: value },
    };
  }
  return null;
}

function readCustomPropertyValues(
  draftInput: NotionDraftInput,
  rule: NotionCustomPropertyRule,
): string[] {
  if (rule.valueSource === "participants") {
    return sanitizeParticipantNames(
      draftInput.speakers
        .filter((speaker) => speaker.is_bot === 0)
        .map((speaker) => speaker.display_name_snapshot),
    ).map((value) => value.slice(0, rule.maxLength));
  }

  const notionProperties = draftInput.draftContent.notionProperties;
  const entry = notionProperties?.[rule.propertyName];
  const rawValues = isRecord(entry) && Array.isArray(entry.values)
    ? entry.values
    : Array.isArray(entry)
      ? entry
      : typeof entry === "string"
        ? [entry]
        : [];
  const seen = new Set<string>();
  const values: string[] = [];
  for (const rawValue of rawValues) {
    if (typeof rawValue !== "string") {
      continue;
    }
    const value = rawValue.replace(/\s+/g, " ").trim();
    if (!value) {
      continue;
    }
    const key = value.toLocaleLowerCase("ko-KR");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    values.push(value.slice(0, rule.maxLength));
  }
  return values;
}

async function renderRelationProperty(input: {
  client: NotionClient | null;
  rule: NotionCustomPropertyRule;
  values: readonly string[];
}): Promise<Array<{ id: string }>> {
  const fixedPageId = readRelationTargetPageId(input.rule);
  if (fixedPageId) {
    return [{ id: fixedPageId }];
  }
  if (!input.client) {
    return [];
  }
  if (input.values.length === 0) {
    return [];
  }
  const target = await resolveRelationTarget(input.client, input.rule);
  if (!target) {
    return [];
  }

  const matchPropertyName = input.rule.relationMatchPropertyName || "Name";
  const matchProperty = readDataSourceProperties(target.dataSource)[matchPropertyName];
  if (!matchProperty) {
    return [];
  }
  const relation: Array<{ id: string }> = [];
  for (const value of input.values.slice(0, 25)) {
    const pageId = await findOrCreateRelationPage({
      client: input.client,
      targetId: target.id,
      matchPropertyName,
      matchPropertyType: matchProperty.type ?? "unknown",
      value,
      autoCreate: input.rule.relationAutoCreate,
    });
    if (pageId) {
      relation.push({ id: pageId });
    }
  }
  return relation;
}

function readRelationTargetPageId(rule: NotionCustomPropertyRule): string | null {
  const storedId = rule.relationTargetPageId
    ? normalizeNotionId(rule.relationTargetPageId)
    : null;
  if (storedId) {
    return storedId;
  }
  if (!rule.relationTargetPageUrl) {
    return null;
  }
  const parsed = parseNotionPageUrl(rule.relationTargetPageUrl);
  return parsed.kind === "page_id" ? parsed.id : null;
}

async function resolveRelationTarget(
  client: NotionClient,
  rule: NotionCustomPropertyRule,
): Promise<RemoteResolvedTarget | null> {
  if (rule.relationTargetUrl) {
    const parsed = parseNotionTargetUrl(rule.relationTargetUrl);
    if (parsed.kind !== "invalid") {
      return await resolveTarget(client, parsed);
    }
  }
  if (rule.relationDataSourceId) {
    const dataSource = await client.retrieveDataSource(rule.relationDataSourceId);
    return {
      id: rule.relationDataSourceId,
      name: readTargetName(dataSource),
      dataSource,
    };
  }
  return null;
}

async function findOrCreateRelationPage(input: {
  client: NotionClient;
  targetId: string;
  matchPropertyName: string;
  matchPropertyType: string;
  value: string;
  autoCreate: boolean;
}): Promise<string | null> {
  const filter = buildRelationMatchFilter(input);
  if (!filter) {
    return null;
  }
  const existing = await input.client.queryDataSource(input.targetId, {
    filter,
    page_size: 2,
  });
  const results = readResults(existing);
  if (results.length === 1) {
    return readId(results[0]);
  }
  if (results.length > 1 || !input.autoCreate || input.matchPropertyType !== "title") {
    return null;
  }
  const created = await input.client.createPage({
    parent: { data_source_id: input.targetId },
    properties: {
      [input.matchPropertyName]: {
        title: richText(input.value),
      },
    },
  });
  return readId(created);
}

function buildRelationMatchFilter(input: {
  matchPropertyName: string;
  matchPropertyType: string;
  value: string;
}): Record<string, unknown> | null {
  if (input.matchPropertyType === "title") {
    return {
      property: input.matchPropertyName,
      title: { equals: input.value },
    };
  }
  if (input.matchPropertyType === "rich_text") {
    return {
      property: input.matchPropertyName,
      rich_text: { equals: input.value },
    };
  }
  if (input.matchPropertyType === "select") {
    return {
      property: input.matchPropertyName,
      select: { equals: input.value },
    };
  }
  return null;
}

function readCheckboxValue(value: string): boolean {
  return /^(true|yes|y|1|done|완료|예|네|맞음)$/i.test(value.trim());
}

function readDateValue(value: string): string | null {
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

async function recoverRemoteBlocks(input: {
  client: NotionClient | null;
  writeStore: NotionWriteStore;
  writeId: string;
  pageId: string;
  blocks: RenderedNotionBlock[];
  nowIso: string;
}): Promise<void> {
  if (!input.client) {
    return;
  }
  const response = await input.client.retrieveBlockChildren(input.pageId);
  const remoteBlocks = readResults(response);
  const recovered: Array<{
    blockIndex: number;
    contentHash: string;
    blockId: string | null;
  }> = [];

  for (
    let index = 0;
    index < input.blocks.length && index < remoteBlocks.length;
    index += 1
  ) {
    const planned = input.blocks[index];
    const remote = remoteBlocks[index];
    if (!planned || !remote || !blocksMatch(planned.block, remote)) {
      break;
    }
    recovered.push({
      blockIndex: planned.blockIndex,
      contentHash: planned.contentHash,
      blockId: readId(remote),
    });
  }

  if (recovered.length > 0) {
    input.writeStore.saveRecoveredBlocks({
      writeId: input.writeId,
      blocks: recovered,
      nowIso: input.nowIso,
    });
  }
}

async function appendRemainingBlocks(input: {
  client: NotionClient | null;
  writeStore: NotionWriteStore;
  writeId: string;
  pageId: string;
  blocks: RenderedNotionBlock[];
  nowIso: string;
}): Promise<void> {
  if (!input.client) {
    throw new Error("Notion client is required.");
  }
  const appendedIndexes = new Set(
    input.writeStore
      .listBlocks(input.writeId)
      .filter((block) => block.status === "appended")
      .map((block) => block.block_index),
  );
  const remaining = input.blocks.filter(
    (block) => !appendedIndexes.has(block.blockIndex),
  );

  for (let index = 0; index < remaining.length; index += 100) {
    const batch = remaining.slice(index, index + 100);
    const response = await input.client.appendBlockChildren(input.pageId, {
      children: batch.map((block) => block.block),
    });
    const results = readResults(response);
    if (results.length !== batch.length) {
      throw createWriterValidationError(
        "Notion append response did not match the requested block count.",
        "Notion upload 상태를 확인한 뒤 다시 시도해 주세요.",
        `Notion append returned ${results.length} blocks for ${batch.length} requested blocks.`,
      );
    }

    for (let batchIndex = 0; batchIndex < batch.length; batchIndex += 1) {
      const block = batch[batchIndex];
      if (!block) {
        continue;
      }
      input.writeStore.saveBlockAppended({
        writeId: input.writeId,
        blockIndex: block.blockIndex,
        contentHash: block.contentHash,
        blockId: readId(results[batchIndex]),
        nowIso: input.nowIso,
      });
    }
  }
}

async function resolveTarget(
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

function loadDraftInput(
  readModel: NotionDraftInputReadModel,
  selector: NotionDraftSelector,
): NotionDraftInput | null {
  return selector.kind === "draft"
    ? readModel.loadByDraftId(selector.draftId)
    : readModel.loadLatestValidForSession(selector.sessionId);
}

function persistNotionError(input: {
  error: NotionApiError;
  writeStore: NotionWriteStore;
  writeId: string;
  nowIso: string;
  draftInput: NotionDraftInput;
  target: ResolvedTarget;
  contentHash: string;
  blockCount: number;
}): NotionUploadResult {
  if (input.error.retriable) {
    input.writeStore.markRetryWait({
      id: input.writeId,
      nextAttemptAt: nextAttemptAt(input.nowIso, input.error),
      statusMessage: input.error.message,
      lastError: input.error.technicalDetail,
      nowIso: input.nowIso,
    });
    return errorResult("retry_wait", input);
  }

  input.writeStore.markBlocked({
    id: input.writeId,
    statusMessage: input.error.message,
    lastError: input.error.technicalDetail,
    nowIso: input.nowIso,
  });
  return errorResult("blocked", input);
}

function resultFromNotionError(
  baseResult: NotionUploadResult,
  error: NotionApiError,
): NotionUploadResult {
  return {
    ...baseResult,
    status: error.retriable ? "retry_wait" : "blocked",
    message: error.message,
    userAction: error.userAction,
    technicalDetail: error.technicalDetail,
  };
}

function errorResult(
  status: Extract<NotionUploadStatus, "retry_wait" | "blocked">,
  input: {
    error: NotionApiError;
    writeId: string;
    draftInput: NotionDraftInput;
    target: ResolvedTarget;
    contentHash: string;
    blockCount: number;
  },
): NotionUploadResult {
  return {
    ...createBaseResult(false),
    status,
    dbChanged: true,
    sessionId: input.draftInput.session.id,
    draftId: input.draftInput.draft.id,
    targetId: input.target.id,
    targetName: input.target.name,
    writeId: input.writeId,
    contentHash: input.contentHash,
    blockCount: input.blockCount,
    message: input.error.message,
    userAction: input.error.userAction,
    technicalDetail: input.error.technicalDetail,
  };
}

function doneResult(input: {
  dryRun: boolean;
  draftInput: NotionDraftInput;
  target: ResolvedTarget;
  write: NotionWriteRow;
  contentHash: string;
  blockCount: number;
  dbChanged: boolean;
  message: string;
  warnings?: readonly string[];
}): NotionUploadResult {
  return {
    ...createBaseResult(input.dryRun),
    status: "done",
    dbChanged: input.dbChanged,
    sessionId: input.draftInput.session.id,
    draftId: input.draftInput.draft.id,
    targetId: input.target.id,
    targetName: input.target.name,
    writeId: input.write.id,
    pageId: input.write.notion_page_id,
    pageUrl: input.write.notion_page_url,
    contentHash: input.contentHash,
    blockCount: input.blockCount,
    message: input.message,
    warnings: [...(input.warnings ?? [])],
  };
}

function createBaseResult(dryRun: boolean): NotionUploadResult {
  return {
    status: "failed",
    dbChanged: false,
    dryRun,
    sessionId: null,
    draftId: null,
    targetId: null,
    targetName: null,
    writeId: null,
    pageId: null,
    pageUrl: null,
    contentHash: null,
    blockCount: 0,
    message: "",
    userAction: null,
    technicalDetail: null,
    warnings: [],
  };
}

function nextAttemptAt(nowIso: string, error: NotionApiError): string {
  const nowMs = new Date(nowIso).getTime();
  const delaySeconds = error.retryAfterSeconds ?? 60;
  return new Date(nowMs + delaySeconds * 1000).toISOString();
}

function createWriterValidationError(
  message: string,
  userAction: string,
  technicalDetail: string,
): NotionApiError {
  return new NotionApiErrorClass("validation", message, {
    status: null,
    code: "writer_validation",
    retryAfterSeconds: null,
    retriable: false,
    userAction,
    technicalDetail,
  });
}

function readPageRef(value: unknown): { id: string; url: string | null } {
  const id = readId(value);
  if (!id) {
    throw new Error("Notion page id가 응답에 없습니다.");
  }
  return {
    id,
    url: isRecord(value) && typeof value.url === "string" ? value.url : null,
  };
}

function readTargetName(dataSource: Record<string, unknown>): string {
  if (typeof dataSource.name === "string" && dataSource.name.trim()) {
    return dataSource.name.trim();
  }
  if (Array.isArray(dataSource.title)) {
    const title = readRichTextPlainText(dataSource.title);
    if (title) {
      return title;
    }
  }
  return "Notion data source";
}

function blocksMatch(planned: NotionBlockPayload, remote: unknown): boolean {
  if (!isRecord(remote) || remote.type !== planned.type) {
    return false;
  }
  return readRemotePlainText(remote) === extractPlainTextFromBlock(planned);
}

function readRemotePlainText(remote: Record<string, unknown>): string {
  const typed = remote[remote.type as string];
  if (!isRecord(typed) || !Array.isArray(typed.rich_text)) {
    return "";
  }
  return readRichTextPlainText(typed.rich_text);
}

function readRichTextPlainText(value: unknown[]): string {
  return value
    .map((part) =>
      isRecord(part) && typeof part.plain_text === "string"
        ? part.plain_text
        : isRecord(part) &&
            isRecord(part.text) &&
            typeof part.text.content === "string"
          ? part.text.content
          : "",
    )
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
