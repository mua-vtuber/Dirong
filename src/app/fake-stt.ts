import process from "node:process";
import {
  parseCliArgs,
  readPositiveIntegerArg,
  readRequiredStringArg,
  type CliArgSpec,
} from "../cli/arg-parser.js";
import { printCliError } from "../cli/error-output.js";
import { loadPhase1Config } from "../config.js";
import { runFakeSttBatch } from "../stt/fake-runner.js";
import { SessionStore } from "../storage/session-store.js";
import { DirongDatabase } from "../storage/sqlite.js";
import { backupDatabaseSnapshot } from "./sqlite-backup.js";

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
    if (backupPaths.length > 0) {
      console.log("SQLite snapshot backup 생성:");
      for (const backupPath of backupPaths) {
        console.log(`- ${backupPath}`);
      }
      console.log("");
    }
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

  console.log("디롱이 Fake STT 결과");
  console.log(`DB: ${config.dbPath}`);
  console.log(`mode: ${options.dryRun ? "dry-run" : "write"}`);
  console.log(`limit: ${result.limit}`);
  console.log(`session: ${result.sessionId ?? "all"}`);
  console.log(`expired leases released: ${result.expiredLeasesReleased}`);
  console.log(`examined: ${result.examined}`);
  console.log(`done: ${result.done}`);
  console.log(`missing audio: ${result.missingAudio}`);
  console.log(`failed: ${result.failed}`);
  console.log(`more queued jobs hint: ${result.remainingQueuedHint > 0 ? "yes" : "no"}`);
  console.log("");
  console.log("samples:");
  console.log(JSON.stringify(result.samples.slice(0, 10), null, 2));

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
  "--dry-run": {
    kind: "boolean",
    apply: (options) => {
      options.dryRun = true;
    },
  },
  "--debug": {
    kind: "boolean",
    apply: (options) => {
      options.debug = true;
    },
  },
  "--no-backup": {
    kind: "boolean",
    apply: (options) => {
      options.backup = false;
    },
  },
  "--limit": {
    kind: "value",
    read: readPositiveIntegerArg,
    apply: (options, value) => {
      options.limit = value;
    },
  },
  "--session": {
    kind: "value",
    read: (value) => readRequiredStringArg(value, "--session 값이 필요합니다."),
    apply: (options, value) => {
      options.sessionId = value;
    },
  },
  "--lease-ms": {
    kind: "value",
    read: readPositiveIntegerArg,
    apply: (options, value) => {
      options.leaseMs = value;
    },
  },
};
