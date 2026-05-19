import process from "node:process";
import { printCliError } from "../cli/error-output.js";
import { t } from "../i18n/catalog.js";
import { loadProductRuntimeSettings } from "../settings/product-settings.js";
import { runStartupRepair } from "../storage/repair-scan.js";
import { createStorageContext } from "../storage/storage-context.js";
import { DirongDatabase } from "../storage/sqlite.js";

try {
  const config = loadProductRuntimeSettings().config;
  const database = new DirongDatabase(config.dbPath, config.dbBusyTimeoutMs);
  const ctx = createStorageContext(database, {
    storageRoot: config.dataDir,
    normalizeStoredPaths: true,
  });
  const repairSummary = await runStartupRepair(ctx, config);

  console.log(t("ko", "runtimeCli.phaseCli.repairTitle"));
  console.log(`SQLite DB: ${config.dbPath}`);
  console.log(JSON.stringify(repairSummary, null, 2));
  console.log("");
  console.log(t("ko", "runtimeCli.phaseCli.repairNotice"));

  ctx.close();
} catch (error) {
  printCliError(error);
  process.exit(1);
}
