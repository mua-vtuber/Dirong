import process from "node:process";
import { printCliError } from "../cli/error-output.js";
import { loadPhase1Config } from "../config.js";
import { runStartupRepair } from "../storage/repair-scan.js";
import { SessionStore } from "../storage/session-store.js";
import { DirongDatabase } from "../storage/sqlite.js";

try {
  const config = loadPhase1Config({ requireDiscordConfig: false });
  const database = new DirongDatabase(config.dbPath, config.dbBusyTimeoutMs);
  const store = new SessionStore(database);
  const repairSummary = await runStartupRepair(store, config);

  console.log("디롱이 Recording + STT repair 결과");
  console.log(`SQLite DB: ${config.dbPath}`);
  console.log(JSON.stringify(repairSummary, null, 2));
  console.log("");
  console.log("repair는 DB 상태를 수정할 수 있는 명시 명령입니다.");

  store.close();
} catch (error) {
  printCliError(error);
  process.exit(1);
}
