import process from "node:process";
import { FakeAiCleanupProvider } from "../ai/cleanup/fake-provider.js";
import { createAiCleanupProviderFromSettings } from "../ai/cleanup/provider-factory.js";
import { runAiCleanupForSession } from "../ai/cleanup/runner.js";
import type { AiCleanupProvider } from "../ai/cleanup/provider.js";
import { printCliError, resolveCliLocale } from "../cli/error-output.js";
import { t } from "../i18n/catalog.js";
import { loadProductRuntimeSettings } from "../settings/product-settings.js";
import {
  buildNotionCustomPropertyPrompt,
  NotionCustomPropertyRuleStore,
} from "../notion/property-rules.js";
import {
  buildNotionMemberRosterPrompt,
  NotionMemberRosterStore,
} from "../notion/member-roster-store.js";
import type { AiCleanupRuntimeSettings } from "../settings/app-settings.js";
import {
  createStorageContext,
  flattenStorageContext,
  type FlatStorageStore,
} from "../storage/storage-context.js";
import { SqlRunner } from "../storage/sql-runner.js";
import { DirongDatabase } from "../storage/sqlite.js";
import {
  parsePhase4AiCleanupArgs,
  type Phase4AiCleanupCliOptions,
} from "./phase4-ai-cleanup-cli.js";
import { backupDatabaseSnapshot } from "../storage/sqlite-backup.js";

let store: FlatStorageStore | null = null;

try {
  const options = parsePhase4AiCleanupArgs(process.argv.slice(2));
  const productRuntime = loadProductRuntimeSettings();
  const config = productRuntime.config;
  const aiCleanupSettings = productRuntime.appSettings.aiCleanup;
  const provider = createProvider(options, aiCleanupSettings);
  const database = new DirongDatabase(config.dbPath, config.dbBusyTimeoutMs, {
    readOnly: options.dryRun,
  });
  const ctx = createStorageContext(database, {
    storageRoot: config.dataDir,
    normalizeStoredPaths: !options.dryRun,
  });
  store = flattenStorageContext(ctx);
  const notionPropertyRuleStore = new NotionCustomPropertyRuleStore(
    new SqlRunner(database),
  );
  const notionMemberRosterStore = new NotionMemberRosterStore(
    new SqlRunner(database),
  );

  const result = await runAiCleanupForSession(store, {
    sessionId: options.sessionId,
    dryRun: options.dryRun,
    provider,
    locale: resolveCliLocale(),
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
    customNotionPropertyPrompt: (context) =>
      buildNotionCustomPropertyPrompt(
        notionPropertyRuleStore.listEnabledRules(
          "meeting",
          context.projectId ?? undefined,
        ),
      ),
    memberRosterPrompt: (context) =>
      buildNotionMemberRosterPrompt(
        notionMemberRosterStore.listLatestForPrompt(
          100,
          context.projectId ?? undefined,
        ),
      ),
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
  const provider = providerNameToSettingsProvider(
    options.provider,
    aiCleanupSettings.provider,
  );

  return createAiCleanupProviderFromSettings({
    ...aiCleanupSettings,
    provider,
    mode: providerNameToSettingsMode(options.provider, aiCleanupSettings.mode),
    command: resolveProviderCommand(provider, aiCleanupSettings),
    claudeCommand:
      provider === "claude"
        ? resolveProviderCommand(provider, aiCleanupSettings)
        : aiCleanupSettings.claudeCommand,
    model: options.model ?? aiCleanupSettings.model,
    claudeModel: options.model ?? aiCleanupSettings.claudeModel,
  });
}

function providerNameToSettingsProvider(
  provider: Phase4AiCleanupCliOptions["provider"],
  fallback: AiCleanupRuntimeSettings["provider"],
): AiCleanupRuntimeSettings["provider"] {
  if (provider === "codex-cli") {
    return "codex";
  }
  if (provider === "gemini-cli") {
    return "gemini";
  }
  if (provider === "claude-cli") {
    return "claude";
  }
  if (provider === "claude-api") {
    return "claude";
  }
  return fallback;
}

function providerNameToSettingsMode(
  provider: Phase4AiCleanupCliOptions["provider"],
  fallback: AiCleanupRuntimeSettings["mode"],
): AiCleanupRuntimeSettings["mode"] {
  if (
    provider === "claude-cli" ||
    provider === "codex-cli" ||
    provider === "gemini-cli"
  ) {
    return "cli";
  }
  if (provider === "claude-api") {
    return "api";
  }
  return fallback;
}

function resolveProviderCommand(
  provider: AiCleanupRuntimeSettings["provider"],
  settings: AiCleanupRuntimeSettings,
): string {
  if (provider === settings.provider) {
    return settings.command;
  }
  if (provider === "codex") {
    return "codex";
  }
  if (provider === "gemini") {
    return "gemini";
  }
  return settings.claudeCommand;
}

function printResult(
  dbPath: string,
  result: Awaited<ReturnType<typeof runAiCleanupForSession>>,
  options: Phase4AiCleanupCliOptions,
): void {
  const locale = resolveCliLocale();
  console.log(t(locale, "runtimeCli.phaseCli.phase4Title"));
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
    console.log(t(locale, "runtimeCli.phaseCli.fakeSttIncludedWarning"));
  }
  console.log(`input chars: ${result.inputChars} / ${result.maxInputChars}`);
  console.log(`DB changed: ${result.dbChanged ? "yes" : "no"}`);

  if (result.backupPaths.length > 0) {
    console.log("SQLite snapshot backup:");
    for (const backupPath of result.backupPaths) {
      console.log(`- ${backupPath}`);
    }
  } else if (result.dryRun) {
    console.log(t(locale, "runtimeCli.phaseCli.backupDryRunSkipped"));
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
