import { existsSync } from "node:fs";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { printCliError } from "../cli/error-output.js";
import { loadPhase1Config } from "../config.js";
import { runHealthCheck, type HealthCheck } from "../health.js";
import { loadAppSettingsFromEnv } from "../settings/env-settings-loader.js";
import {
  assertPhase3SttProviderReady,
  createPhase3SttProvider,
} from "../stt/provider-factory.js";

type DbSummary = {
  exists: boolean;
  sessions: number;
  activeSessions: number;
  queuedJobs: number;
  processingJobs: number;
  doneJobs: number;
  failedJobs: number;
  transcriptSegments: number;
  noSpeechSegments: number;
  openRepairItems: number;
};

try {
  const config = loadPhase1Config({ requireDiscordConfig: false });
  const health = await runHealthCheck();
  const appHealthChecks = adaptHealthChecksForRecordingSttDoctor(health.checks);
  const sttChecks = await runSttReadinessChecks();
  const dbSummary = readDbSummary(config.dbPath, config.dbBusyTimeoutMs);

  console.log("디롱이 Recording + STT doctor 결과");
  console.log(`생성 시각: ${health.generatedAt}`);
  console.log(`Node.js: ${health.nodeVersion}`);
  console.log(`플랫폼: ${health.platform} ${health.arch}`);
  console.log(`SQLite DB: ${config.dbPath}`);
  console.log(`Dashboard bind: ${config.dashboardHost}:${config.dashboardPort}`);
  console.log("");

  printChecks("기본 실행 환경", appHealthChecks);
  printChecks("STT provider", sttChecks);
  printDbSummary(dbSummary);

  console.log("");
  console.log("이 doctor는 read-only입니다. DB repair가 필요하면 npm run repair를 실행해 주세요.");
  console.log("Discord 토큰과 API key 값은 출력하지 않았습니다.");

  const failed = [...appHealthChecks, ...sttChecks].filter(
    (check) => check.status === "fail",
  );
  if (failed.length > 0) {
    console.log("");
    console.log("실패한 항목이 있습니다. 위 조치 안내를 먼저 확인해 주세요.");
    process.exit(1);
  }
} catch (error) {
  printCliError(error);
  process.exit(1);
}

function adaptHealthChecksForRecordingSttDoctor(
  checks: HealthCheck[],
): HealthCheck[] {
  return checks.map((check) => {
    if (check.name !== "Discord voice channel ID") {
      return check;
    }

    if (check.status === "ok") {
      return {
        ...check,
        name: "Discord voice channel ID (optional)",
        message: "설정됨(값은 출력하지 않음). 일반 녹음에는 필요하지 않습니다.",
        action: undefined,
      };
    }

    return {
      ...check,
      name: "Discord voice channel ID (optional)",
      status: "ok",
      message: "일반 녹음에는 필요하지 않습니다. /dirong start는 사용자가 들어간 음성 채널을 사용합니다.",
      action: undefined,
    };
  });
}

async function runSttReadinessChecks(): Promise<HealthCheck[]> {
  const appSettings = loadAppSettingsFromEnv();
  const { provider, settings } = createPhase3SttProvider(appSettings.stt);

  if (settings.provider === "openai") {
    return [
      {
        name: "STT provider",
        status: "ok",
        message: "OpenAI STT provider 선택됨",
      },
      {
        name: "OpenAI API key",
        status: settings.openai.apiKey ? "ok" : "fail",
        message: settings.openai.apiKey
          ? "OPENAI_API_KEY 설정됨(값은 출력하지 않음)"
          : "OPENAI_API_KEY가 설정되지 않았습니다. OpenAI API 호출은 하지 않았습니다.",
        action: settings.openai.apiKey
          ? undefined
          : ".env에 OPENAI_API_KEY를 설정하거나 local-whisper provider를 사용해 주세요.",
      },
    ];
  }

  console.log("local-whisper 모델 로딩 검사는 시간이 걸릴 수 있습니다...");
  try {
    assertPhase3SttProviderReady({ settings, dryRun: false });
    await provider.preflight?.();
    return [
      {
        name: "STT provider",
        status: "ok",
        message: "local-whisper provider 선택됨",
      },
      {
        name: "local-whisper readiness",
        status: "ok",
        message: `${provider.modelName} 모델을 ${settings.localWhisper.device}/${settings.localWhisper.computeType} 설정으로 로드할 수 있습니다.`,
      },
    ];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [
      {
        name: "STT provider",
        status: "ok",
        message: "local-whisper provider 선택됨",
      },
      {
        name: "local-whisper readiness",
        status: "fail",
        message,
        action: "모델 경로와 Python 환경을 확인해 주세요. Windows에서는 먼저 cpu/int8 설정을 사용해 주세요.",
      },
    ];
  }
}

function printChecks(title: string, checks: HealthCheck[]): void {
  console.log(`[${title}]`);
  for (const check of checks) {
    const icon = check.status === "ok" ? "[OK]" : check.status === "fail" ? "[FAIL]" : "[WARN]";
    console.log(`${icon} ${check.name}: ${check.message}`);
    if (check.action) {
      console.log(`     조치: ${check.action}`);
    }
  }
  console.log("");
}

function readDbSummary(dbPath: string, busyTimeoutMs: number): DbSummary {
  if (!existsSync(dbPath)) {
    return {
      exists: false,
      sessions: 0,
      activeSessions: 0,
      queuedJobs: 0,
      processingJobs: 0,
      doneJobs: 0,
      failedJobs: 0,
      transcriptSegments: 0,
      noSpeechSegments: 0,
      openRepairItems: 0,
    };
  }

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    db.exec(`PRAGMA busy_timeout = ${Math.trunc(busyTimeoutMs)};`);
    return {
      exists: true,
      sessions: countRows(db, "sessions"),
      activeSessions: countWhere(db, "sessions", "status IN ('active', 'reconnecting', 'stopping')"),
      queuedJobs: countWhere(db, "stt_jobs", "status = 'queued'"),
      processingJobs: countWhere(db, "stt_jobs", "status = 'processing'"),
      doneJobs: countWhere(db, "stt_jobs", "status = 'done'"),
      failedJobs: countWhere(db, "stt_jobs", "status IN ('failed', 'failed_missing_file')"),
      transcriptSegments: countRows(db, "transcript_segments"),
      noSpeechSegments: countWhere(
        db,
        "transcript_segments",
        "speech_status = 'no_speech'",
        ["speech_status"],
      ),
      openRepairItems: countWhere(db, "repair_items", "status = 'open'"),
    };
  } finally {
    db.close();
  }
}

function printDbSummary(summary: DbSummary): void {
  console.log("[SQLite 상태]");
  if (!summary.exists) {
    console.log("[WARN] 아직 세션 DB가 없습니다. /dirong start로 첫 녹음을 시작하면 생성됩니다.");
    console.log("");
    return;
  }

  console.log(`[OK] sessions: ${summary.sessions}개`);
  console.log(`[OK] active/reconnecting/stopping sessions: ${summary.activeSessions}개`);
  console.log(
    `[OK] STT jobs: queued=${summary.queuedJobs}, processing=${summary.processingJobs}, done=${summary.doneJobs}, failed=${summary.failedJobs}`,
  );
  console.log(`[OK] transcript segments: ${summary.transcriptSegments}개, no_speech=${summary.noSpeechSegments}개`);
  console.log(`[${summary.openRepairItems > 0 ? "WARN" : "OK"}] open repair items: ${summary.openRepairItems}개`);
  console.log("");
}

function countRows(db: DatabaseSync, tableName: string): number {
  if (!tableExists(db, tableName)) {
    return 0;
  }
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number };
  return row.count;
}

function countWhere(
  db: DatabaseSync,
  tableName: string,
  whereClause: string,
  requiredColumns: string[] = [],
): number {
  if (!tableExists(db, tableName)) {
    return 0;
  }
  if (
    requiredColumns.some((columnName) =>
      !tableColumnExists(db, tableName, columnName)
    )
  ) {
    return 0;
  }
  const row = db.prepare(
    `SELECT COUNT(*) AS count FROM ${tableName} WHERE ${whereClause}`,
  ).get() as { count: number };
  return row.count;
}

function tableExists(db: DatabaseSync, tableName: string): boolean {
  const row = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
  ).get(tableName);
  return row !== undefined;
}

function tableColumnExists(
  db: DatabaseSync,
  tableName: string,
  columnName: string,
): boolean {
  const row = db.prepare(`PRAGMA table_info(${tableName});`).all() as Array<{
    name: string;
  }>;
  return row.some((column) => column.name === columnName);
}
