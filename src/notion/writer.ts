import {
  type NotionClient,
  NotionApiError as NotionApiErrorClass,
} from "./client.js";
import {
  appendRemainingBlocks,
  recoverRemoteBlocks,
} from "./block-sync.js";
import { NotionDraftInputReadModel } from "./draft-input-read-model.js";
import type { NotionDraftInput } from "./draft-input.js";
import type { NotionCustomPropertyRule } from "./property-rules.js";
import type { NotionRuntimeSettings } from "./settings.js";
import type { NotionRegistryStore } from "./registry-store.js";
import {
  readId,
  readResults,
} from "./data-source-readers.js";
import { buildManagedMemberMatchFilter } from "./member-match-filter.js";
import {
  buildNotionTaskSourceActionId,
  renderNotionTaskPageProperties,
} from "./page-properties.js";
import {
  createBaseResult,
  createWriterValidationError,
  doneResult,
  persistNotionError,
  resultFromNotionError,
  type NotionUploadResult,
} from "./upload-result.js";
import {
  resolveUploadTarget,
  type ManagedResolvedTarget,
  type ResolvedTarget,
} from "./upload-target-resolver.js";
import { renderUploadPlan } from "./upload-plan-renderer.js";
import {
  renderNotionCustomPageProperties,
  resolveManagedMemberRelations,
} from "./relation-resolver.js";
import type { NotionMemberRosterStore } from "./member-roster-store.js";
import type { NotionWriteRow, NotionWriteStore } from "./write-store.js";

export type {
  NotionUploadResult,
  NotionUploadStatus,
} from "./upload-result.js";

export type NotionDraftSelector =
  | { kind: "draft"; draftId: string }
  | { kind: "session"; sessionId: string };

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
  memberRosterStore?: NotionMemberRosterStore | null;
  customPropertyRules?: readonly NotionCustomPropertyRule[];
};

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
        "Notion 업로드를 켜려면 설정 마법사에서 Notion 연결 토큰을 저장해 주세요.",
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
      extraWarnings: [
        ...memberRelations.warnings,
        ...(target.kind === "managed" ? target.actionItemWarnings : []),
      ],
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
    const actionItemWarnings = target.kind === "managed"
      ? await syncManagedActionItemPages({
          client: options.client,
          target,
          draftInput,
          meetingPageId: page.id,
          memberRosterStore: options.memberRosterStore ?? null,
        })
      : [];
    const warnings = [...renderPlan.warnings, ...actionItemWarnings];
    writeStore.markDone({
      id: claimed.id,
      statusMessage: actionItemWarnings.length > 0
        ? `Notion upload complete with ${actionItemWarnings.length} action item warning(s)`
        : "Notion upload complete",
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
      warnings,
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

async function syncManagedActionItemPages(input: {
  client: NotionClient | null;
  target: ManagedResolvedTarget;
  draftInput: NotionDraftInput;
  meetingPageId: string;
  memberRosterStore: NotionMemberRosterStore | null;
}): Promise<string[]> {
  const warnings: string[] = [];
  if (!input.client || !input.target.actionItemTarget) {
    return warnings;
  }

  for (const actionItem of input.draftInput.draftContent.actionItems) {
    const sourceActionId = buildNotionTaskSourceActionId({
      draftId: input.draftInput.draft.id,
      actionItemId: actionItem.id,
    });
    try {
      const workerPageId = await resolveActionItemWorkerPage({
        client: input.client,
        target: input.target,
        ownerName: actionItem.owner.status === "explicit"
          ? actionItem.owner.name
          : null,
        sourceActionId,
        memberRosterStore: input.memberRosterStore,
      });
      const properties = renderNotionTaskPageProperties({
        actionItem,
        propertiesBySemanticKey: input.target.actionItemTarget.properties,
        meetingPageId: input.meetingPageId,
        workerRelationPageId: workerPageId.pageId,
        sourceActionId,
        locale: input.draftInput.draftContent.language,
      });
      warnings.push(...workerPageId.warnings);
      const existing = await findExistingActionItemPage({
        client: input.client,
        target: input.target,
        sourceActionId,
      });
      if (existing.status === "ambiguous") {
        warnings.push(
          `${sourceActionId}: 같은 Dirong 할 일 ID를 가진 할 일 페이지가 여러 개라 업데이트를 건너뜁니다.`,
        );
        continue;
      }
      if (existing.pageId) {
        await input.client.updatePage(existing.pageId, { properties });
        continue;
      }
      await input.client.createPage({
        parent: {
          data_source_id: input.target.actionItemTarget.database.dataSourceId,
        },
        properties,
      });
    } catch (error) {
      warnings.push(
        `${sourceActionId}: 할 일 페이지 동기화 중 오류가 발생했습니다 (${error instanceof Error ? error.message : String(error)}).`,
      );
    }
  }

  return warnings;
}

async function findExistingActionItemPage(input: {
  client: NotionClient;
  target: ManagedResolvedTarget;
  sourceActionId: string;
}): Promise<{ status: "none" | "found" | "ambiguous"; pageId: string | null }> {
  const sourceProperty =
    input.target.actionItemTarget?.properties["task.sourceActionId"];
  if (!input.target.actionItemTarget || !sourceProperty) {
    return { status: "none", pageId: null };
  }
  const response = await input.client.queryDataSource(
    input.target.actionItemTarget.database.dataSourceId,
    {
      filter: {
        property: sourceProperty.name,
        rich_text: { equals: input.sourceActionId },
      },
      page_size: 2,
    },
  );
  const results = readResults(response);
  if (results.length > 1) {
    return { status: "ambiguous", pageId: null };
  }
  if (results.length === 1) {
    return { status: "found", pageId: readId(results[0]) };
  }
  return { status: "none", pageId: null };
}

async function resolveActionItemWorkerPage(input: {
  client: NotionClient;
  target: ManagedResolvedTarget;
  ownerName: string | null;
  sourceActionId: string;
  memberRosterStore: NotionMemberRosterStore | null;
}): Promise<{ pageId: string | null; warnings: string[] }> {
  const ownerName = input.ownerName?.trim();
  if (!ownerName) {
    return { pageId: null, warnings: [] };
  }
  const filter = buildManagedMemberMatchFilter(
    input.target.memberDiscordNameProperty,
    ownerName,
  );
  if (!filter) {
    return {
      pageId: null,
      warnings: [
        `${input.sourceActionId}: 작업자 매칭 속성 타입을 지원하지 않아 담당자 relation을 비웠습니다.`,
      ],
    };
  }
  const response = await input.client.queryDataSource(
    input.target.memberDatabase.dataSourceId,
    { filter, page_size: 2 },
  );
  const results = readResults(response);
  if (results.length === 1) {
    return { pageId: readId(results[0]), warnings: [] };
  }
  if (results.length > 1) {
    return {
      pageId: null,
      warnings: [
        `${input.sourceActionId}: 작업자 "${ownerName}"와 일치하는 Notion page가 여러 개라 담당자 relation을 비웠습니다.`,
      ],
    };
  }
  if (input.memberRosterStore) {
    const cachedNameMatches = input.memberRosterStore.findByDiscordName(
      input.target.memberDatabase.dataSourceId,
      ownerName,
    );
    if (cachedNameMatches.length === 1) {
      return { pageId: cachedNameMatches[0]?.pageId ?? null, warnings: [] };
    }
    if (cachedNameMatches.length > 1) {
      return {
        pageId: null,
        warnings: [
          `${input.sourceActionId}: 작업자 "${ownerName}"와 일치하는 roster 캐시 항목이 여러 개라 담당자 relation을 비웠습니다.`,
        ],
      };
    }

    const cachedRoleMatches = input.memberRosterStore.findByRole(
      input.target.memberDatabase.dataSourceId,
      ownerName,
    );
    if (cachedRoleMatches.length === 1) {
      return { pageId: cachedRoleMatches[0]?.pageId ?? null, warnings: [] };
    }
    if (cachedRoleMatches.length > 1) {
      return {
        pageId: null,
        warnings: [
          `${input.sourceActionId}: 역할 "${ownerName}"와 일치하는 작업자가 여러 명이라 담당자 relation을 비웠습니다.`,
        ],
      };
    }
    return {
      pageId: null,
      warnings: [
        `${input.sourceActionId}: 작업자 또는 역할 "${ownerName}"와 일치하는 roster 캐시 항목을 찾지 못해 담당자 relation을 비웠습니다.`,
      ],
    };
  }
  return {
    pageId: null,
    warnings: [
      `${input.sourceActionId}: 작업자 "${ownerName}"를 Notion 작업자 DB에서 찾지 못해 담당자 relation을 비웠습니다.`,
    ],
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
