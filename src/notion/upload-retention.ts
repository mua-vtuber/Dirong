import type { NotionUploadResult } from "./writer.js";

export type NotionUploadRetentionHandler = (
  result: NotionUploadResult,
) => Promise<void> | void;

export async function applyRetentionAfterSuccessfulUpload(
  retention: NotionUploadRetentionHandler | undefined,
  result: NotionUploadResult,
): Promise<void> {
  if (!retention || result.status !== "done" || !result.sessionId) {
    return;
  }
  await retention(result);
}
