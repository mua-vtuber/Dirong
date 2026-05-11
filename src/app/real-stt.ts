import process from "node:process";
import { printCliError } from "../cli/error-output.js";
import {
  formatSttRunSummary,
  printSqliteBackupSummary,
} from "../cli/stt-summary.js";
import { loadPhase1Config } from "../config.js";
import { loadAppSettingsFromEnv } from "../settings/env-settings-loader.js";
import {
  assertPhase3SttProviderReady,
  createPhase3SttProvider,
} from "../stt/provider-factory.js";
import { runSttBatch } from "../stt/runner.js";
import { SessionStore } from "../storage/session-store.js";
import { DirongDatabase } from "../storage/sqlite.js";
import { backupDatabaseSnapshot } from "../storage/sqlite-backup.js";
import { parsePhase3SttArgs } from "./phase3-stt-cli.js";

try {
  const options = parsePhase3SttArgs(process.argv.slice(2));
  const phase1Config = loadPhase1Config({ requireDiscordConfig: false });
  const appSettings = loadAppSettingsFromEnv();
  const { provider, settings: sttSettings } = createPhase3SttProvider(
    appSettings.stt,
    {
      provider: options.provider,
      model: options.model,
    },
  );

  assertPhase3SttProviderReady({
    settings: sttSettings,
    dryRun: options.dryRun,
  });

  if (!options.dryRun) {
    await provider.preflight?.();
  }

  if (!options.dryRun && options.backup) {
    const backupPaths = backupDatabaseSnapshot(phase1Config.dbPath, {
      busyTimeoutMs: phase1Config.dbBusyTimeoutMs,
    });
    printSqliteBackupSummary(backupPaths, {
      missingDatabaseMessage: "SQLite DB 파일이 아직 없어 backup을 만들지 않았습니다.",
    });
  }

  const database = new DirongDatabase(phase1Config.dbPath, phase1Config.dbBusyTimeoutMs);
  const store = new SessionStore(database, {
    storageRoot: phase1Config.dataDir,
    normalizeStoredPaths: !options.dryRun,
  });

  const result = await runSttBatch(store, {
    workerId: `real-stt-${provider.providerName}-${process.pid}`,
    limit: options.limit,
    sessionId: options.sessionId,
    leaseMs: options.leaseMs ?? phase1Config.sttLeaseMs,
    dryRun: options.dryRun,
    source: "real",
    provider,
    language: sttSettings.language,
    timeoutMs: sttSettings.timeoutMs,
    contextSegments: 2,
  });

  console.log(formatSttRunSummary({
    title: "디롱이 Real STT 결과",
    dbPath: phase1Config.dbPath,
    mode: options.dryRun ? "dry-run" : "write",
    detailLines: [
      `provider: ${result.provider}`,
      `model: ${result.model}`,
      `language: ${result.language ?? "-"}`,
    ],
    noteLines:
      options.dryRun && sttSettings.provider !== "openai"
        ? ["OPENAI_API_KEY는 없지만 현재 provider dry-run에는 필요하지 않습니다."]
        : [],
    result,
  }));

  store.close();
} catch (error) {
  printCliError(error);
  process.exit(1);
}
