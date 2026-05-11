import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PHASE4_AI_CLEANUP_PROMPT_VERSION } from "./prompts.js";
import { sha256Text } from "./timeline-input.js";

export type AiCleanupArtifactPaths = {
  jobId: string;
  inputJsonPath: string;
  inputMarkdownPath: string;
  promptPath: string;
  rawOutputPath: string;
  stderrPath: string;
  repairPromptPath: string;
  repairRawOutputPath: string;
  repairStderrPath: string;
  draftJsonPath: string;
  draftMarkdownPath: string;
};

export function makeArtifactPaths(input: {
  sessionDataDir: string;
  provider: string;
  model: string;
  inputHash: string;
  jobId: string;
}): AiCleanupArtifactPaths {
  const dir = path.resolve(input.sessionDataDir, "ai-cleanup");
  const safeProvider = sanitizePathPart(input.provider);
  const safeModel = sanitizePathPart(input.model);
  const hash = input.inputHash.slice(0, 16);

  return {
    jobId: input.jobId,
    inputJsonPath: path.join(
      dir,
      `input.phase3.5-transcript-timeline-v1.${hash}.json`,
    ),
    inputMarkdownPath: path.join(
      dir,
      `input.phase3.5-transcript-timeline-v1.${hash}.md`,
    ),
    promptPath: path.join(
      dir,
      `prompt.${PHASE4_AI_CLEANUP_PROMPT_VERSION}.${input.jobId}.txt`,
    ),
    rawOutputPath: path.join(dir, `raw.${safeProvider}.${safeModel}.${input.jobId}.txt`),
    stderrPath: path.join(
      dir,
      `stderr.${safeProvider}.${safeModel}.${input.jobId}.txt`,
    ),
    repairPromptPath: path.join(
      dir,
      `prompt.repair.${PHASE4_AI_CLEANUP_PROMPT_VERSION}.${input.jobId}.txt`,
    ),
    repairRawOutputPath: path.join(
      dir,
      `raw.repair.${safeProvider}.${safeModel}.${input.jobId}.txt`,
    ),
    repairStderrPath: path.join(
      dir,
      `stderr.repair.${safeProvider}.${safeModel}.${input.jobId}.txt`,
    ),
    draftJsonPath: path.join(dir, `draft.${input.jobId}.json`),
    draftMarkdownPath: path.join(dir, `draft.${input.jobId}.md`),
  };
}

export function makeAiCleanupJobId(input: {
  sessionId: string;
  provider: string;
  model: string;
  promptVersion: string;
  inputHash: string;
}): string {
  const stable = sha256Text(
    `${input.sessionId}\n${input.provider}\n${input.model}\n${input.promptVersion}\n${input.inputHash}`,
  ).slice(0, 16);
  return `ai_${sanitizePathPart(input.sessionId).slice(0, 48)}_${stable}`;
}

export function writeTextAtomic(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const partPath = `${filePath}.part`;
  writeFileSync(partPath, content, "utf8");
  renameSync(partPath, filePath);
}

function sanitizePathPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 80) || "unknown";
}
