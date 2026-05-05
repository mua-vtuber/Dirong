import process from "node:process";
import { runHealthCheck } from "./health.js";

const report = await runHealthCheck();

console.log("디롱이 Phase 0 doctor 결과");
console.log(`생성 시각: ${report.generatedAt}`);
console.log(`Node.js: ${report.nodeVersion}`);
console.log(`플랫폼: ${report.platform} ${report.arch}`);
console.log("");

for (const check of report.checks) {
  const icon = check.status === "ok" ? "[OK]" : check.status === "fail" ? "[FAIL]" : "[WARN]";
  console.log(`${icon} ${check.name}: ${check.message}`);
  if (check.action) {
    console.log(`     조치: ${check.action}`);
  }
}

console.log("");
console.log(`FFmpeg: ${report.ffmpeg.path ?? "missing"}`);
console.log(`Opus: ${report.opusLibrary ?? "missing"}`);
console.log(`DAVE: ${report.daveLibrary ?? "not directly resolved"}`);
console.log("");
console.log("Discord 토큰 값은 출력하지 않았습니다.");

const failed = report.checks.filter((check) => check.status === "fail");
if (failed.length > 0) {
  console.log("");
  console.log("실패한 필수 항목이 있습니다. 위 조치 안내를 먼저 확인해 주세요.");
  process.exit(1);
}
