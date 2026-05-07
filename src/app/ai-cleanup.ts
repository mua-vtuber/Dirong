import process from "node:process";
import { FakeAiCleanupProvider } from "../ai/cleanup/fake-provider.js";
import { ClaudeStreamJsonCliCleanupProvider } from "../ai/cleanup/claude-persistent-cli-provider.js";
import { runAiCleanupForSession } from "../ai/cleanup/runner.js";
import type { AiCleanupProvider } from "../ai/cleanup/provider.js";
import { printCliError } from "../cli/error-output.js";
import { loadPhase1Config } from "../config.js";
import { loadAiCleanupSettingsFromEnv } from "../settings/env-settings-loader.js";
import type { AiCleanupRuntimeSettings } from "../settings/app-settings.js";
import { SessionStore } from "../storage/session-store.js";
import { DirongDatabase } from "../storage/sqlite.js";
import {
  parsePhase4AiCleanupArgs,
  type Phase4AiCleanupCliOptions,
} from "./phase4-ai-cleanup-cli.js";
import { backupDatabaseSnapshot } from "./sqlite-backup.js";

let store: SessionStore | null = null;

try {
  const options = parsePhase4AiCleanupArgs(process.argv.slice(2));
  const config = loadPhase1Config({ requireDiscordConfig: false });
  const aiCleanupSettings = loadAiCleanupSettingsFromEnv(process.env);
  const provider = createProvider(options, aiCleanupSettings);
  const database = new DirongDatabase(config.dbPath, config.dbBusyTimeoutMs, {
    readOnly: options.dryRun,
  });
  store = new SessionStore(database, {
    storageRoot: config.dataDir,
    normalizeStoredPaths: !options.dryRun,
  });

  const result = await runAiCleanupForSession(store, {
    sessionId: options.sessionId,
    dryRun: options.dryRun,
    provider,
    workerId: `phase4-ai-cleanup-${provider.providerName}-${process.pid}`,
    leaseMs:
      options.leaseMs ??
      aiCleanupSettings.leaseMs ??
      config.sttLeaseMs,
    maxAttempts: aiCleanupSettings.maxAttempts,
    maxInputChars:
      options.maxInputChars ??
      aiCleanupSettings.maxInputChars,
    timeoutMs:
      options.timeoutMs ?? aiCleanupSettings.timeoutMs,
    maxOutputBytes:
      options.maxOutputBytes ??
      aiCleanupSettings.maxOutputBytes,
    includeFakeStt: options.includeFakeStt,
    backup:
      !options.dryRun && options.backup
        ? () =>
            backupDatabaseSnapshot(config.dbPath, {
              busyTimeoutMs: config.dbBusyTimeoutMs,
            })
        : undefined,
  });

  printResult(config.dbPath, result, options);
} catch (error) {
  printCliError(error, { args: process.argv });
  process.exitCode = 1;
} finally {
  store?.close();
}

function createProvider(
  options: Phase4AiCleanupCliOptions,
  aiCleanupSettings: AiCleanupRuntimeSettings,
): AiCleanupProvider {
  if (options.provider === "fake") {
    return new FakeAiCleanupProvider();
  }

  return new ClaudeStreamJsonCliCleanupProvider({
    command: aiCleanupSettings.claudeCommand,
    model: options.model ?? aiCleanupSettings.claudeModel,
  });
}

function printResult(
  dbPath: string,
  result: Awaited<ReturnType<typeof runAiCleanupForSession>>,
  options: Phase4AiCleanupCliOptions,
): void {
  console.log("디롱이 Phase 4 AI cleanup 결과");
  console.log(`DB: ${dbPath}`);
  console.log(`mode: ${result.dryRun ? "dry-run" : "write"}`);
  console.log(`status: ${result.status}`);
  console.log(`provider: ${result.provider}`);
  console.log(`model: ${result.model}`);
  console.log(`session: ${result.sessionId}`);
  console.log(`input hash: ${result.inputHash}`);
  console.log(`timeline entries: ${result.inputEntryCount}`);
  console.log(`include fake STT: ${options.includeFakeStt ? "yes" : "no"}`);
  if (options.smokeTest) {
    console.log("smoke test: yes");
  }
  if (options.includeFakeStt) {
    console.log("주의: 테스트 전사용(fake STT) 입력이 포함되었습니다. 일반 회의록 생성 경로에서는 사용하지 마세요.");
  }
  console.log(`input chars: ${result.inputChars} / ${result.maxInputChars}`);
  console.log(`DB changed: ${result.dbChanged ? "yes" : "no"}`);

  if (result.backupPaths.length > 0) {
    console.log("SQLite snapshot backup:");
    for (const backupPath of result.backupPaths) {
      console.log(`- ${backupPath}`);
    }
  } else if (result.dryRun) {
    console.log("SQLite snapshot backup: dry-run에서는 생성하지 않음");
  }

  if (result.job) {
    console.log(
      `AI job: ${result.job.id} / ${result.job.status} / attempts ${result.job.attempts}/${result.job.max_attempts}`,
    );
    if (result.job.failure_kind) {
      console.log(`failure kind: ${result.job.failure_kind}`);
    }
    if (result.job.last_error) {
      console.log(`last error: ${result.job.last_error}`);
    }
  }

  if (result.draft) {
    console.log(`draft json: ${result.draft.json_path}`);
    console.log(`draft markdown: ${result.draft.markdown_path}`);
  }

  if (result.error) {
    console.log(`error: ${result.error}`);
  }

  console.log("");
  console.log("timeline preview:");
  for (const line of result.timelineMarkdownPreview) {
    console.log(`- ${line}`);
  }
}
