import process from "node:process";
import { printCliError } from "../cli/error-output.js";
import { t } from "../i18n/catalog.js";
import type { DirongLocale } from "../settings/local-settings-store.js";
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
  type RetentionPolicy,
} from "../storage/file-retention.js";
import type {
  SessionPurgeCandidate,
  SessionPurgeCounts,
} from "../storage/session-purge.js";
import { DirongDatabase } from "../storage/sqlite.js";
import { parseSessionPurgeArgs } from "./session-purge-cli.js";

try {
  const productRuntime = loadProductRuntimeSettings();
  const locale = productRuntime.setupStatus.getLocale();
  const options = parseSessionPurgeArgs(process.argv.slice(2), locale);
  const config = productRuntime.config;
  const backupPaths =
    options.operation === "purge-sessions" && !options.dryRun && options.backup
      ? backupDatabaseSnapshot(config.dbPath, {
          busyTimeoutMs: config.dbBusyTimeoutMs,
          failureMessageLines: [
            t(locale, "sessionPurge.backup.failureLine1"),
            t(locale, "sessionPurge.backup.failureLine2"),
            t(locale, "sessionPurge.backup.failureLine3"),
          ],
        })
      : [];
  const database = new DirongDatabase(config.dbPath, config.dbBusyTimeoutMs);

  try {
    if (options.operation === "expired-text-artifacts") {
      // 자동 정리 스케줄러와 같은 settings.retention을 사용해 수동/자동 cutoff를 일치시킨다.
      const retention = productRuntime.localSettings.retention;
      const policy: RetentionPolicy = {
        deleteAudioAfterNotionUpload:
          retention.deleteAudioAfterNotionUpload ??
          DEFAULT_RETENTION_POLICY.deleteAudioAfterNotionUpload,
        textDraftRetentionDays:
          retention.textDraftRetentionDays ??
          DEFAULT_RETENTION_POLICY.textDraftRetentionDays,
      };
      const plans = buildExpiredTextArtifactDeletionPlans({
        database,
        storageRoot: config.dataDir,
        policy,
      });
      const results = options.dryRun
        ? []
        : plans.map((plan) => executeRetentionDeletionPlan(plan));
      assertNoFileRetentionFailures(results, locale);

      console.log(t(locale, "sessionPurge.expiredTextArtifactsTitle"));
      console.log(`mode: ${options.dryRun ? "dry-run" : "confirmed"}`);
      console.log(`data root: ${config.dataDir}`);
      console.log(`target sessions: ${plans.length}`);
      console.log(t(locale, "sessionPurge.fileDeletionPlanTitle"));
      console.log(formatFileRetentionPlans(plans, results, locale));
      console.log("");
      console.log(
        options.dryRun
          ? t(locale, "sessionPurge.dryRunHint")
          : t(locale, "sessionPurge.expiredTextArtifactsDone"),
      );
    } else {
      const result = purgeSessions({
        database,
        storageRoot: config.dataDir,
        selector: options.selector,
        dryRun: options.dryRun,
      });

      console.log(t(locale, "sessionPurge.sessionPurgeTitle"));
      console.log(`mode: ${options.dryRun ? "dry-run" : "confirmed"}`);
      console.log(`SQLite DB: ${config.dbPath}`);
      if (backupPaths.length > 0) {
        console.log(`backup: ${backupPaths.join(", ")}`);
      }
      console.log(`targets: ${result.candidates.length}`);
      console.log(formatCounts(result.counts));
      console.log("");
      console.log(t(locale, "sessionPurge.targetSessionsTitle"));
      console.log(formatCandidates(result.candidates, locale));
      console.log("");
      console.log(t(locale, "sessionPurge.fileDeletionPlanTitle"));
      console.log(
        formatFileRetentionPlans(
          result.fileRetentionPlans,
          result.fileRetentionResults,
          locale,
        ),
      );
      console.log("");
      console.log(
        options.dryRun
          ? t(locale, "sessionPurge.dryRunHint")
          : t(locale, "sessionPurge.sessionPurgeDone"),
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

function formatCandidates(
  candidates: readonly SessionPurgeCandidate[],
  locale: DirongLocale,
): string {
  if (candidates.length === 0) {
    return t(locale, "sessionPurge.none");
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
  locale: DirongLocale,
): void {
  const failures = results.flatMap((result) =>
    result.results.filter((item) => item.status === "failed"),
  );
  if (failures.length === 0) {
    return;
  }
  throw new Error(formatFileRetentionFailures(failures, locale));
}

function formatFileRetentionFailures(
  failures: readonly RetentionDeletionOutcome[],
  locale: DirongLocale,
): string {
  return failures
    .map((item) =>
      [
        t(locale, "sessionPurge.fileDeletionFailed"),
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
  locale: DirongLocale,
): string {
  const targetCount = plans.reduce((sum, plan) => sum + plan.targets.length, 0);
  if (targetCount === 0) {
    return t(locale, "sessionPurge.none");
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
