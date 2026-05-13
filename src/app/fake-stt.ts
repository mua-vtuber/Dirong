import process from "node:process";
import {
  booleanOptionArg,
  parseCliArgs,
  positiveIntegerOptionArg,
  requiredStringOptionArg,
  type CliArgSpec,
} from "../cli/arg-parser.js";
import { printCliError } from "../cli/error-output.js";
import {
  formatSttRunSummary,
  printSqliteBackupSummary,
} from "../cli/stt-summary.js";
import { loadPhase1Config } from "../config.js";
import { runFakeSttBatch } from "../stt/fake-runner.js";
import { SessionStore } from "../storage/session-store.js";
import { DirongDatabase } from "../storage/sqlite.js";
import { backupDatabaseSnapshot } from "../storage/sqlite-backup.js";

type CliOptions = {
  limit: number;
  sessionId: string | null;
  dryRun: boolean;
  backup: boolean;
  leaseMs: number | null;
  debug: boolean;
};

try {
  const options = parseArgs(process.argv.slice(2));
  const config = loadPhase1Config({ requireDiscordConfig: false });

  if (!options.dryRun && options.backup) {
    const backupPaths = backupDatabaseSnapshot(config.dbPath, {
      busyTimeoutMs: config.dbBusyTimeoutMs,
    });
    printSqliteBackupSummary(backupPaths);
  }

  const database = new DirongDatabase(config.dbPath, config.dbBusyTimeoutMs);
  const store = new SessionStore(database, {
    storageRoot: config.dataDir,
    normalizeStoredPaths: !options.dryRun,
  });

  const result = await runFakeSttBatch(store, {
    workerId: `fake-stt-${process.pid}`,
    limit: options.limit,
    sessionId: options.sessionId,
    leaseMs: options.leaseMs ?? config.sttLeaseMs,
    dryRun: options.dryRun,
  });

  console.log(formatSttRunSummary({
    title: "디롱이 Fake STT 결과",
    dbPath: config.dbPath,
    mode: options.dryRun ? "dry-run" : "write",
    result,
  }));

  store.close();
} catch (error) {
  printCliError(error);
  process.exit(1);
}

function parseArgs(args: string[]): CliOptions {
  return parseCliArgs(
    args,
    {
      limit: 10,
      sessionId: null,
      dryRun: false,
      backup: true,
      leaseMs: null,
      debug: false,
    },
    FAKE_STT_ARG_SPEC,
    (flag) => `알 수 없는 Phase 2 fake STT 옵션입니다: ${flag}`,
  );
}

const FAKE_STT_ARG_SPEC: Record<string, CliArgSpec<CliOptions>> = {
  "--dry-run": booleanOptionArg("dryRun", true),
  "--debug": booleanOptionArg("debug", true),
  "--no-backup": booleanOptionArg("backup", false),
  "--limit": positiveIntegerOptionArg("limit"),
  "--session": requiredStringOptionArg("--session 값이 필요합니다.", "sessionId"),
  "--lease-ms": positiveIntegerOptionArg("leaseMs"),
};
