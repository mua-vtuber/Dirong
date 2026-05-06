import process from "node:process";
import { FakeAiCleanupProvider } from "../ai/cleanup/fake-provider.js";
import { ClaudeCliCleanupProvider } from "../ai/cleanup/claude-cli-provider.js";
import { runAiCleanupForSession } from "../ai/cleanup/runner.js";
import type { AiCleanupProvider } from "../ai/cleanup/provider.js";
import { printCliError } from "../cli/error-output.js";
import { loadPhase1Config } from "../config.js";
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
  const provider = createProvider(options);
  const database = new DirongDatabase(config.dbPath, config.dbBusyTimeoutMs, {
    readOnly: options.dryRun,
  });
  store = new SessionStore(database);

  const result = await runAiCleanupForSession(store, {
    sessionId: options.sessionId,
    dryRun: options.dryRun,
    provider,
    workerId: `phase4-ai-cleanup-${provider.providerName}-${process.pid}`,
    leaseMs:
      options.leaseMs ??
      readEnvNumber("PHASE4_AI_LEASE_MS", config.sttLeaseMs),
    maxAttempts: readEnvNumber("PHASE4_AI_MAX_ATTEMPTS", 3),
    maxInputChars:
      options.maxInputChars ??
      readEnvNumber("PHASE4_AI_MAX_INPUT_CHARS", 120000),
    timeoutMs:
      options.timeoutMs ?? readEnvNumber("PHASE4_AI_TIMEOUT_MS", 120000),
    maxOutputBytes:
      options.maxOutputBytes ??
      readEnvNumber("PHASE4_AI_MAX_OUTPUT_BYTES", 2 * 1024 * 1024),
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

function createProvider(options: Phase4AiCleanupCliOptions): AiCleanupProvider {
  if (options.provider === "fake") {
    return new FakeAiCleanupProvider();
  }

  return new ClaudeCliCleanupProvider({
    command: process.env.PHASE4_CLAUDE_COMMAND?.trim() || "claude",
    model: options.model ?? process.env.PHASE4_CLAUDE_MODEL?.trim() ?? null,
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

function readEnvNumber(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} 값은 1 이상의 정수여야 합니다.`);
  }
  return parsed;
}
