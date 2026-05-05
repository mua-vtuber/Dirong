import process from "node:process";
import { loadPhase1Config } from "../config.js";
import { safeErrorInfo, toKoreanErrorMessage } from "../errors.js";
import { runHealthCheck } from "../health.js";
import { runStartupRepair } from "../storage/repair-scan.js";
import { SessionStore } from "../storage/session-store.js";
import { DirongDatabase } from "../storage/sqlite.js";

try {
  const config = loadPhase1Config({ requireDiscordConfig: false });
  const database = new DirongDatabase(config.dbPath, config.dbBusyTimeoutMs);
  const store = new SessionStore(database);
  const health = await runHealthCheck();
  const repairSummary = await runStartupRepair(store, config);

  console.log("디롱이 Phase 1 doctor 결과");
  console.log(`생성 시각: ${health.generatedAt}`);
  console.log(`Node.js: ${health.nodeVersion}`);
  console.log(`플랫폼: ${health.platform} ${health.arch}`);
  console.log(`SQLite DB: ${config.dbPath}`);
  console.log(`Dashboard bind: ${config.dashboardHost}:${config.dashboardPort}`);
  console.log("");

  for (const check of health.checks) {
    const icon = check.status === "ok" ? "[OK]" : check.status === "fail" ? "[FAIL]" : "[WARN]";
    console.log(`${icon} ${check.name}: ${check.message}`);
    if (check.action) {
      console.log(`     조치: ${check.action}`);
    }
  }

  console.log("");
  console.log("startup repair summary:");
  console.log(JSON.stringify(repairSummary, null, 2));
  console.log("");
  console.log("Discord 토큰 값은 출력하지 않았습니다.");

  store.close();

  const failed = health.checks.filter((check) => check.status === "fail");
  if (failed.length > 0) {
    console.log("");
    console.log("실패한 필수 항목이 있습니다. 위 조치 안내를 먼저 확인해 주세요.");
    process.exit(1);
  }
} catch (error) {
  console.error(toKoreanErrorMessage(error));
  console.error(JSON.stringify(safeErrorInfo(error), null, 2));
  process.exit(1);
}
