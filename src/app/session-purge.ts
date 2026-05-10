import process from "node:process";
import { printCliError } from "../cli/error-output.js";
import { loadPhase1Config } from "../config.js";
import { backupDatabaseSnapshot } from "../storage/sqlite-backup.js";
import { purgeSessions } from "../storage/session-purge.js";
import type { SessionPurgeCandidate, SessionPurgeCounts } from "../storage/session-purge.js";
import { DirongDatabase } from "../storage/sqlite.js";
import { parseSessionPurgeArgs } from "./session-purge-cli.js";

try {
  const options = parseSessionPurgeArgs(process.argv.slice(2));
  const config = loadPhase1Config({ requireDiscordConfig: false });
  const backupPaths =
    !options.dryRun && options.backup
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
    console.log(
      options.dryRun
        ? "실제 삭제하려면 같은 명령에 --confirm을 붙여 실행하세요."
        : "session 관련 행만 삭제했습니다. Notion Property Rules는 보존했습니다.",
    );
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
