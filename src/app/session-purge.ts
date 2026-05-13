import process from "node:process";
import { printCliError } from "../cli/error-output.js";
import { loadProductRuntimeSettings } from "../settings/product-settings.js";
import { backupDatabaseSnapshot } from "../storage/sqlite-backup.js";
import { purgeSessions } from "../storage/session-purge.js";
import {
  DEFAULT_RETENTION_POLICY,
  buildExpiredTextArtifactDeletionPlans,
  executeRetentionDeletionPlan,
  type RetentionDeletionOutcome,
  type RetentionDeletionExecutionResult,
  type RetentionDeletionPlan,
} from "../storage/file-retention.js";
import type {
  SessionPurgeCandidate,
  SessionPurgeCounts,
} from "../storage/session-purge.js";
import { DirongDatabase } from "../storage/sqlite.js";
import { parseSessionPurgeArgs } from "./session-purge-cli.js";

try {
  const options = parseSessionPurgeArgs(process.argv.slice(2));
  const config = loadProductRuntimeSettings().config;
  const backupPaths =
    options.operation === "purge-sessions" && !options.dryRun && options.backup
      ? backupDatabaseSnapshot(config.dbPath, {
          busyTimeoutMs: config.dbBusyTimeoutMs,
          failureMessageLines: [
            "SQLite backup 생성에 실패했습니다.",
            "session purge를 적용하지 않고 중단합니다.",
            "backup이 실패했으므로 DB 상태는 변경하지 않았습니다.",
          ],
        })
      : [];
  const database = new DirongDatabase(config.dbPath, config.dbBusyTimeoutMs);

  try {
    if (options.operation === "expired-text-artifacts") {
      const plans = buildExpiredTextArtifactDeletionPlans({
        database,
        storageRoot: config.dataDir,
        policy: DEFAULT_RETENTION_POLICY,
      });
      const results = options.dryRun
        ? []
        : plans.map((plan) => executeRetentionDeletionPlan(plan));
      assertNoFileRetentionFailures(results);

      console.log("디롱이 expired text artifact retention 결과");
      console.log(`mode: ${options.dryRun ? "dry-run" : "confirmed"}`);
      console.log(`data root: ${config.dataDir}`);
      console.log(`target sessions: ${plans.length}`);
      console.log("파일 삭제 계획");
      console.log(formatFileRetentionPlans(plans, results));
      console.log("");
      console.log(
        options.dryRun
          ? "실제 삭제하려면 같은 명령에 --confirm을 붙여 실행하세요."
          : "기간이 만료된 텍스트/초안 artifact 파일을 삭제했습니다.",
      );
    } else {
      const result = purgeSessions({
        database,
        storageRoot: config.dataDir,
        selector: options.selector,
        dryRun: options.dryRun,
      });

      console.log("디롱이 session purge 결과");
      console.log(`mode: ${options.dryRun ? "dry-run" : "confirmed"}`);
      console.log(`SQLite DB: ${config.dbPath}`);
      if (backupPaths.length > 0) {
        console.log(`backup: ${backupPaths.join(", ")}`);
      }
      console.log(`targets: ${result.candidates.length}`);
      console.log(formatCounts(result.counts));
      console.log("");
      console.log("대상 세션");
      console.log(formatCandidates(result.candidates));
      console.log("");
      console.log("파일 삭제 계획");
      console.log(
        formatFileRetentionPlans(
          result.fileRetentionPlans,
          result.fileRetentionResults,
        ),
      );
      console.log("");
      console.log(
        options.dryRun
          ? "실제 삭제하려면 같은 명령에 --confirm을 붙여 실행하세요."
          : "session 관련 행과 계획된 로컬 파일을 삭제했습니다. Notion Property Rules는 보존했습니다.",
      );
    }
  } finally {
    database.close();
  }
} catch (error) {
  printCliError(error);
  process.exit(1);
}

function formatCounts(counts: SessionPurgeCounts): string {
  return [
    `sessions=${counts.sessions}`,
    `speakers=${counts.sessionSpeakers}`,
    `chunks=${counts.chunks}`,
    `sttJobs=${counts.sttJobs}`,
    `transcripts=${counts.transcriptSegments}`,
    `aiJobs=${counts.aiCleanupJobs}`,
    `drafts=${counts.meetingNotesDrafts}`,
    `notionWrites=${counts.notionWrites}`,
    `notionBlocks=${counts.notionBlocks}`,
    `events=${counts.connectionEvents}`,
    `repairs=${counts.repairItems}`,
    `notionPropertyRulesPreserved=${counts.notionCustomPropertyRules}`,
  ].join(" / ");
}

function formatCandidates(candidates: readonly SessionPurgeCandidate[]): string {
  if (candidates.length === 0) {
    return "없음";
  }

  return candidates
    .map((candidate) =>
      [
        `- ${candidate.sessionId}`,
        `status=${candidate.status}`,
        `chunks=${candidate.chunkCount}`,
        `missingRaw=${candidate.missingRawAudioCount}`,
        `missingStt=${candidate.missingSttAudioCount}`,
        `dataDirExists=${candidate.dataDirExists}`,
        `dataDir=${candidate.dataDir}`,
      ].join(" / "),
    )
    .join("\n");
}

function assertNoFileRetentionFailures(
  results: readonly RetentionDeletionExecutionResult[],
): void {
  const failures = results.flatMap((result) =>
    result.results.filter((item) => item.status === "failed"),
  );
  if (failures.length === 0) {
    return;
  }
  throw new Error(formatFileRetentionFailures(failures));
}

function formatFileRetentionFailures(
  failures: readonly RetentionDeletionOutcome[],
): string {
  return failures
    .map((item) =>
      [
        "파일 삭제 실패",
        `session=${item.target.sessionId}`,
        `kind=${item.target.kind}`,
        `path=${item.target.resolvedPath ?? item.target.path}`,
        `error=${item.error ?? "unknown"}`,
      ].join(" / "),
    )
    .join("\n");
}

function formatFileRetentionPlans(
  plans: readonly RetentionDeletionPlan[],
  results: readonly RetentionDeletionExecutionResult[],
): string {
  const targetCount = plans.reduce((sum, plan) => sum + plan.targets.length, 0);
  if (targetCount === 0) {
    return "없음";
  }

  const resultsBySession = new Map(
    results.map((result) => [result.plan.sessionId, result]),
  );
  return plans
    .flatMap((plan) => {
      const execution = resultsBySession.get(plan.sessionId);
      return plan.targets.map((target) => {
        const outcome = execution?.results.find((item) => item.target === target);
        const status = outcome?.status ?? (target.exists ? "would-delete" : "missing");
        const error = outcome?.error ? ` / error=${outcome.error}` : "";
        return [
          `- ${plan.sessionId}`,
          `source=${target.sourceTable}:${target.sourceId}`,
          `kind=${target.kind}`,
          `status=${status}`,
          `path=${target.resolvedPath ?? target.path}`,
        ].join(" / ") + error;
      });
    })
    .join("\n");
}
