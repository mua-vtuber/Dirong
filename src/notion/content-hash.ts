import { createHash } from "node:crypto";

export const NOTION_RENDERER_CONTRACT_VERSION = "phase5-notion-renderer-v1";

export type NotionContentHashInput = {
  draftId: string;
  draftOutputHash: string;
  sessionId: string;
  targetDataSourceId: string;
  propertyValues: unknown;
  renderedBlocks: unknown;
  rendererContractVersion?: string;
};

export function computeNotionContentHash(
  input: NotionContentHashInput,
): string {
  return sha256Canonical({
    schemaVersion: "phase5-notion-content-hash-v1",
    draftId: input.draftId,
    draftOutputHash: input.draftOutputHash,
    sessionId: input.sessionId,
    targetDataSourceId: input.targetDataSourceId,
    propertyValues: input.propertyValues,
    renderedBlocks: input.renderedBlocks,
    rendererContractVersion:
      input.rendererContractVersion ?? NOTION_RENDERER_CONTRACT_VERSION,
  });
}

export function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalStringify(value)).digest("hex");
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(sortForJson(value));
}

function sortForJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortForJson);
  }

  if (!isRecord(value)) {
    return value;
  }

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortForJson(value[key]);
  }
  return sorted;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
