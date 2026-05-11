import {
  type NotionApiError,
  NotionApiError as NotionApiErrorClass,
} from "./client.js";
import type { NotionDraftInput } from "./draft-input.js";
import type { NotionWriteRow, NotionWriteStore } from "./write-store.js";

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

export type NotionUploadTargetSummary = {
  id: string;
  name: string;
};

export function persistNotionError(input: {
  error: NotionApiError;
  writeStore: NotionWriteStore;
  writeId: string;
  nowIso: string;
  draftInput: NotionDraftInput;
  target: NotionUploadTargetSummary;
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

export function resultFromNotionError(
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

export function doneResult(input: {
  dryRun: boolean;
  draftInput: NotionDraftInput;
  target: NotionUploadTargetSummary;
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

export function createBaseResult(dryRun: boolean): NotionUploadResult {
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

export function createWriterValidationError(
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

function errorResult(
  status: Extract<NotionUploadStatus, "retry_wait" | "blocked">,
  input: {
    error: NotionApiError;
    writeId: string;
    draftInput: NotionDraftInput;
    target: NotionUploadTargetSummary;
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

function nextAttemptAt(nowIso: string, error: NotionApiError): string {
  const nowMs = new Date(nowIso).getTime();
  const delaySeconds = error.retryAfterSeconds ?? 60;
  return new Date(nowMs + delaySeconds * 1000).toISOString();
}
