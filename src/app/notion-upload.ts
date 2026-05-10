import process from "node:process";
import { printCliError } from "../cli/error-output.js";
import { loadPhase1Config } from "../config.js";
import { createNotionClient } from "../notion/client.js";
import { NotionDraftInputReadModel } from "../notion/draft-input-read-model.js";
import { NotionRegistryStore } from "../notion/registry-store.js";
import { NotionCustomPropertyRuleStore } from "../notion/property-rules.js";
import { runNotionUpload } from "../notion/writer.js";
import type { NotionDraftSelector } from "../notion/writer.js";
import { NotionWriteStore } from "../notion/write-store.js";
import { loadNotionSettingsFromEnv } from "../settings/env-settings-loader.js";
import { SqlRunner } from "../storage/sql-runner.js";
import { DirongDatabase } from "../storage/sqlite.js";
import { parsePhase5NotionUploadArgs } from "./phase5-notion-upload-cli.js";

let database: DirongDatabase | null = null;

try {
  const options = parsePhase5NotionUploadArgs(process.argv.slice(2));
  const config = loadPhase1Config({ requireDiscordConfig: false });
  const settings = loadNotionSettingsFromEnv(process.env);
  database = new DirongDatabase(config.dbPath, config.dbBusyTimeoutMs, {
    readOnly: options.dryRun,
  });
  const runner = new SqlRunner(database);
  const client = settings.apiKey
    ? createNotionClient({
        apiKey: settings.apiKey,
        apiVersion: settings.apiVersion,
        baseUrl: settings.baseUrl,
      })
    : null;
  const result = await runNotionUpload({
    settings,
    selector: selectorFromOptions(options),
    dryRun: options.dryRun,
    force: options.force,
    workerId: `phase5-notion-upload-${process.pid}`,
    leaseMs: settings.leaseMs,
    client,
    readModel: new NotionDraftInputReadModel(runner),
    writeStore: options.dryRun ? null : new NotionWriteStore(runner),
    registryStore: new NotionRegistryStore(runner),
    customPropertyRules: new NotionCustomPropertyRuleStore(runner).listEnabledRules(),
  });

  printResult(config.dbPath, result, options.debug);
  if (
    result.status === "blocked" ||
    result.status === "failed" ||
    result.status === "not_configured" ||
    result.status === "draft_not_found"
  ) {
    process.exitCode = 1;
  }
} catch (error) {
  printCliError(error, { args: process.argv });
  process.exitCode = 1;
} finally {
  database?.close();
}

function selectorFromOptions(
  options: ReturnType<typeof parsePhase5NotionUploadArgs>,
): NotionDraftSelector {
  return options.draftId
    ? { kind: "draft", draftId: options.draftId }
    : { kind: "session", sessionId: options.sessionId ?? "" };
}

function printResult(
  dbPath: string,
  result: Awaited<ReturnType<typeof runNotionUpload>>,
  debug: boolean,
): void {
  console.log("디롱이 Phase 5 Notion upload 결과");
  console.log(`DB: ${dbPath}`);
  console.log(`mode: ${result.dryRun ? "dry-run" : "write"}`);
  console.log(`status: ${result.status}`);
  console.log(`target: ${result.targetName ?? "n/a"} (${result.targetId ?? "n/a"})`);
  console.log(`session: ${result.sessionId ?? "n/a"}`);
  console.log(`draft: ${result.draftId ?? "n/a"}`);
  console.log(`write: ${result.writeId ?? "n/a"}`);
  console.log(`content hash: ${result.contentHash ?? "n/a"}`);
  console.log(`blocks: ${result.blockCount}`);
  console.log(`DB changed: ${result.dbChanged ? "yes" : "no"}`);
  if (result.pageUrl) {
    console.log(`Notion page: ${result.pageUrl}`);
  }
  if (result.userAction) {
    console.log(`user action: ${result.userAction}`);
  }
  if (debug && result.technicalDetail) {
    console.log(`technical detail: ${result.technicalDetail}`);
  }
  if (result.warnings.length > 0) {
    console.log("warnings:");
    for (const warning of result.warnings) {
      console.log(`- ${warning}`);
    }
  }
  console.log(`message: ${result.message}`);
}
