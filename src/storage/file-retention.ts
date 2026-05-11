import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { DEFAULT_RETENTION_SETTINGS } from "../settings/defaults.js";
import { createStoragePathResolver } from "./path-resolver.js";
import type { DirongDatabase } from "./sqlite.js";

export type RetentionPolicy = {
  deleteAudioAfterNotionUpload: boolean;
  textDraftRetentionDays: number;
};

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = DEFAULT_RETENTION_SETTINGS;

export type RetentionDeletionReason =
  | "notion-upload-success"
  | "session-purge"
  | "expired-text-artifacts";

export type RetentionDeletionFileKind =
  | "raw_audio"
  | "stt_audio"
  | "ai_input_json"
  | "ai_input_markdown"
  | "ai_prompt"
  | "ai_raw_output"
  | "ai_stderr"
  | "ai_parsed_json"
  | "ai_markdown"
  | "draft_json"
  | "draft_markdown"
  | "draft_raw_output";

export type RetentionDeletionTarget = {
  sessionId: string;
  kind: RetentionDeletionFileKind;
  sourceTable: "chunks" | "ai_cleanup_jobs" | "meeting_notes_drafts";
  sourceId: string;
  path: string;
  resolvedPath: string | null;
  exists: boolean;
};

export type RetentionDeletionPlan = {
  sessionId: string;
  storageRoot: string;
  policy: RetentionPolicy;
  reason: RetentionDeletionReason;
  targets: RetentionDeletionTarget[];
};

export type RetentionDeletionOutcome = {
  target: RetentionDeletionTarget;
  status: "deleted" | "missing" | "failed";
  error: string | null;
};

export type RetentionDeletionExecutionResult = {
  plan: RetentionDeletionPlan;
  results: RetentionDeletionOutcome[];
  deleted: number;
  missing: number;
  failed: number;
};

type ChunkArtifactRow = {
  id: string;
  session_id: string;
  raw_audio_path: string | null;
  stt_audio_path: string | null;
};

type AiCleanupArtifactRow = {
  id: string;
  session_id: string;
  created_at: string;
  input_timeline_json_path: string | null;
  input_timeline_markdown_path: string | null;
  prompt_path: string | null;
  raw_output_path: string | null;
  stderr_path: string | null;
  parsed_json_path: string | null;
  markdown_path: string | null;
};

type DraftArtifactRow = {
  id: string;
  session_id: string;
  created_at: string;
  json_path: string | null;
  markdown_path: string | null;
  raw_output_path: string | null;
};

export function buildRetentionDeletionPlan(input: {
  database: DirongDatabase;
  storageRoot: string | null;
  sessionId: string;
  policy: RetentionPolicy;
  reason: RetentionDeletionReason;
  nowIso?: string;
}): RetentionDeletionPlan {
  const storageRoot = requireStorageRoot(input.storageRoot);
  const resolver = createStoragePathResolver(storageRoot);
  const targets: RetentionDeletionTarget[] = [];

  if (shouldIncludeAudio(input.reason, input.policy)) {
    for (const row of selectChunkArtifactRows(input.database, input.sessionId)) {
      addTarget(targets, resolver, {
        sessionId: row.session_id,
        kind: "raw_audio",
        sourceTable: "chunks",
        sourceId: row.id,
        filePath: row.raw_audio_path,
      });
      addTarget(targets, resolver, {
        sessionId: row.session_id,
        kind: "stt_audio",
        sourceTable: "chunks",
        sourceId: row.id,
        filePath: row.stt_audio_path,
      });
    }
  }

  if (shouldIncludeTextArtifacts(input.reason)) {
    const cutoffIso =
      input.reason === "expired-text-artifacts"
        ? computeTextArtifactCutoffIso(input.policy, input.nowIso)
        : null;
    for (const row of selectAiCleanupArtifactRows(input.database, input.sessionId)) {
      if (cutoffIso && row.created_at > cutoffIso) {
        continue;
      }
      addAiCleanupTargets(targets, resolver, row);
    }
    for (const row of selectDraftArtifactRows(input.database, input.sessionId)) {
      if (cutoffIso && row.created_at > cutoffIso) {
        continue;
      }
      addDraftTargets(targets, resolver, row);
    }
  }

  return {
    sessionId: input.sessionId,
    storageRoot,
    policy: normalizePolicy(input.policy),
    reason: input.reason,
    targets: dedupeTargets(targets).sort(compareTargets),
  };
}

export function buildExpiredTextArtifactDeletionPlans(input: {
  database: DirongDatabase;
  storageRoot: string | null;
  policy: RetentionPolicy;
  nowIso?: string;
}): RetentionDeletionPlan[] {
  const cutoffIso = computeTextArtifactCutoffIso(input.policy, input.nowIso);
  return selectSessionIdsWithExpiredTextArtifacts(input.database, cutoffIso).map(
    (sessionId) =>
      buildRetentionDeletionPlan({
        database: input.database,
        storageRoot: input.storageRoot,
        sessionId,
        policy: input.policy,
        reason: "expired-text-artifacts",
        nowIso: input.nowIso,
      }),
  );
}

export function executeRetentionDeletionPlan(
  plan: RetentionDeletionPlan,
): RetentionDeletionExecutionResult {
  const preparedTargets = plan.targets.map((target) => ({
    target,
    absolutePath: requirePathInsideStorageRoot(plan.storageRoot, target),
  }));
  const results: RetentionDeletionOutcome[] = [];

  for (const item of preparedTargets) {
    if (!existsSync(item.absolutePath)) {
      results.push({
        target: item.target,
        status: "missing",
        error: null,
      });
      continue;
    }

    try {
      unlinkSync(item.absolutePath);
      results.push({
        target: item.target,
        status: "deleted",
        error: null,
      });
    } catch (error) {
      results.push({
        target: item.target,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    plan,
    results,
    deleted: results.filter((result) => result.status === "deleted").length,
    missing: results.filter((result) => result.status === "missing").length,
    failed: results.filter((result) => result.status === "failed").length,
  };
}

export function computeTextArtifactCutoffIso(
  policy: RetentionPolicy,
  nowIso = new Date().toISOString(),
): string {
  const normalized = normalizePolicy(policy);
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) {
    throw new Error(`Invalid retention clock value: ${nowIso}`);
  }
  return new Date(
    nowMs - normalized.textDraftRetentionDays * 24 * 60 * 60 * 1000,
  ).toISOString();
}

function normalizePolicy(policy: RetentionPolicy): RetentionPolicy {
  if (
    !Number.isFinite(policy.textDraftRetentionDays) ||
    policy.textDraftRetentionDays < 0
  ) {
    throw new Error("textDraftRetentionDays must be a non-negative number.");
  }
  return {
    deleteAudioAfterNotionUpload: policy.deleteAudioAfterNotionUpload,
    textDraftRetentionDays: Math.floor(policy.textDraftRetentionDays),
  };
}

function requireStorageRoot(storageRoot: string | null): string {
  if (!storageRoot) {
    throw new Error("Retention deletion requires a configured data root.");
  }
  return path.resolve(storageRoot);
}

function shouldIncludeAudio(
  reason: RetentionDeletionReason,
  policy: RetentionPolicy,
): boolean {
  if (reason === "session-purge") {
    return true;
  }
  return reason === "notion-upload-success" && policy.deleteAudioAfterNotionUpload;
}

function shouldIncludeTextArtifacts(reason: RetentionDeletionReason): boolean {
  return reason === "session-purge" || reason === "expired-text-artifacts";
}

function selectChunkArtifactRows(
  database: DirongDatabase,
  sessionId: string,
): ChunkArtifactRow[] {
  return database.db
    .prepare(
      `SELECT id, session_id, raw_audio_path, stt_audio_path
       FROM chunks
       WHERE session_id = ?`,
    )
    .all(sessionId) as ChunkArtifactRow[];
}

function selectAiCleanupArtifactRows(
  database: DirongDatabase,
  sessionId: string,
): AiCleanupArtifactRow[] {
  return database.db
    .prepare(
      `SELECT id, session_id, created_at, input_timeline_json_path,
              input_timeline_markdown_path, prompt_path, raw_output_path,
              stderr_path, parsed_json_path, markdown_path
       FROM ai_cleanup_jobs
       WHERE session_id = ?`,
    )
    .all(sessionId) as AiCleanupArtifactRow[];
}

function selectDraftArtifactRows(
  database: DirongDatabase,
  sessionId: string,
): DraftArtifactRow[] {
  return database.db
    .prepare(
      `SELECT id, session_id, created_at, json_path, markdown_path, raw_output_path
       FROM meeting_notes_drafts
       WHERE session_id = ?`,
    )
    .all(sessionId) as DraftArtifactRow[];
}

function selectSessionIdsWithExpiredTextArtifacts(
  database: DirongDatabase,
  cutoffIso: string,
): string[] {
  const rows = database.db
    .prepare(
      `SELECT DISTINCT session_id
       FROM ai_cleanup_jobs
       WHERE created_at <= ?
       UNION
       SELECT DISTINCT session_id
       FROM meeting_notes_drafts
       WHERE created_at <= ?
       ORDER BY session_id`,
    )
    .all(cutoffIso, cutoffIso) as Array<{ session_id: string }>;
  return rows.map((row) => row.session_id);
}

function addAiCleanupTargets(
  targets: RetentionDeletionTarget[],
  resolver: ReturnType<typeof createStoragePathResolver>,
  row: AiCleanupArtifactRow,
): void {
  const entries = [
    ["ai_input_json", row.input_timeline_json_path],
    ["ai_input_markdown", row.input_timeline_markdown_path],
    ["ai_prompt", row.prompt_path],
    ["ai_raw_output", row.raw_output_path],
    ["ai_stderr", row.stderr_path],
    ["ai_parsed_json", row.parsed_json_path],
    ["ai_markdown", row.markdown_path],
  ] as const;
  for (const [kind, filePath] of entries) {
    addTarget(targets, resolver, {
      sessionId: row.session_id,
      kind,
      sourceTable: "ai_cleanup_jobs",
      sourceId: row.id,
      filePath,
    });
  }
}

function addDraftTargets(
  targets: RetentionDeletionTarget[],
  resolver: ReturnType<typeof createStoragePathResolver>,
  row: DraftArtifactRow,
): void {
  const entries = [
    ["draft_json", row.json_path],
    ["draft_markdown", row.markdown_path],
    ["draft_raw_output", row.raw_output_path],
  ] as const;
  for (const [kind, filePath] of entries) {
    addTarget(targets, resolver, {
      sessionId: row.session_id,
      kind,
      sourceTable: "meeting_notes_drafts",
      sourceId: row.id,
      filePath,
    });
  }
}

function addTarget(
  targets: RetentionDeletionTarget[],
  resolver: ReturnType<typeof createStoragePathResolver>,
  input: {
    sessionId: string;
    kind: RetentionDeletionFileKind;
    sourceTable: RetentionDeletionTarget["sourceTable"];
    sourceId: string;
    filePath: string | null;
  },
): void {
  if (!input.filePath) {
    return;
  }
  const resolved = resolver.resolveStoredPath(input.filePath);
  const resolvedPath = resolved ? path.resolve(resolved) : null;
  targets.push({
    sessionId: input.sessionId,
    kind: input.kind,
    sourceTable: input.sourceTable,
    sourceId: input.sourceId,
    path: input.filePath,
    resolvedPath,
    exists: resolvedPath ? existsSync(resolvedPath) : false,
  });
}

function dedupeTargets(
  targets: readonly RetentionDeletionTarget[],
): RetentionDeletionTarget[] {
  const byPath = new Map<string, RetentionDeletionTarget>();
  for (const target of targets) {
    const key = target.resolvedPath ?? target.path;
    if (!byPath.has(key)) {
      byPath.set(key, target);
    }
  }
  return [...byPath.values()];
}

function compareTargets(
  left: RetentionDeletionTarget,
  right: RetentionDeletionTarget,
): number {
  return (
    left.sessionId.localeCompare(right.sessionId) ||
    left.kind.localeCompare(right.kind) ||
    left.path.localeCompare(right.path)
  );
}

function requirePathInsideStorageRoot(
  storageRoot: string,
  target: RetentionDeletionTarget,
): string {
  if (!target.resolvedPath) {
    throw new Error(`Retention target path is empty: ${target.path}`);
  }

  const absolutePath = path.resolve(target.resolvedPath);
  const relativePath = path.relative(storageRoot, absolutePath);
  const inside =
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
  if (!inside) {
    throw new Error(
      `Retention target is outside data root: ${target.path} (${absolutePath})`,
    );
  }
  return absolutePath;
}
