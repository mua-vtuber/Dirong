import process from "node:process";
import { loadPhase1Config } from "../config.js";
import { safeErrorInfo, toKoreanErrorMessage } from "../errors.js";
import { loadAppSettingsFromEnv } from "../settings/env-settings-loader.js";
import {
  assertPhase3SttProviderReady,
  createPhase3SttProvider,
} from "../stt/provider-factory.js";
import { runSttBatch } from "../stt/runner.js";
import { SessionStore } from "../storage/session-store.js";
import { DirongDatabase } from "../storage/sqlite.js";
import { parsePhase3SttArgs } from "./phase3-stt-cli.js";
import { backupDatabaseFiles } from "./sqlite-backup.js";

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
    const backupPaths = backupDatabaseFiles(phase1Config.dbPath);
    if (backupPaths.length > 0) {
      console.log("SQLite backup 생성:");
      for (const backupPath of backupPaths) {
        console.log(`- ${backupPath}`);
      }
      console.log("");
    } else {
      console.log("SQLite DB 파일이 아직 없어 backup을 만들지 않았습니다.");
      console.log("");
    }
  }

  const database = new DirongDatabase(phase1Config.dbPath, phase1Config.dbBusyTimeoutMs);
  const store = new SessionStore(database);

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

  console.log("디롱이 Phase 3 Real STT 결과");
  console.log(`DB: ${phase1Config.dbPath}`);
  console.log(`mode: ${options.dryRun ? "dry-run" : "write"}`);
  console.log(`provider: ${result.provider}`);
  console.log(`model: ${result.model}`);
  console.log(`language: ${result.language ?? "-"}`);
  console.log(`limit: ${result.limit}`);
  console.log(`session: ${result.sessionId ?? "all"}`);
  console.log(`expired leases released: ${result.expiredLeasesReleased}`);
  console.log(`examined: ${result.examined}`);
  console.log(`done: ${result.done}`);
  console.log(`missing audio: ${result.missingAudio}`);
  console.log(`failed: ${result.failed}`);
  console.log(`more queued jobs hint: ${result.remainingQueuedHint > 0 ? "yes" : "no"}`);
  if (options.dryRun && sttSettings.provider !== "openai") {
    console.log("OPENAI_API_KEY는 없지만 현재 provider dry-run에는 필요하지 않습니다.");
  }
  console.log("");
  console.log("samples:");
  console.log(JSON.stringify(result.samples.slice(0, 10), null, 2));

  store.close();
} catch (error) {
  console.error(toKoreanErrorMessage(error));
  console.error(JSON.stringify(safeErrorInfo(error), null, 2));
  process.exit(1);
}
