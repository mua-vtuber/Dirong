import { existsSync } from "node:fs";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { printCliError } from "../cli/error-output.js";
import { redactSensitiveText, summarizeSafeError } from "../errors.js";
import { runHealthCheck, type HealthCheck } from "../health.js";
import { createNotionClient } from "../notion/client.js";
import {
  readManagedNotionRegistrySnapshot,
  type ManagedNotionRegistrySnapshot,
} from "../notion/managed-registry.js";
import {
  ManagedNotionSchemaStatusService,
  type ManagedNotionSchemaCheckStatus,
  type ManagedNotionSchemaStatusSnapshot,
} from "../notion/managed-schema-status.js";
import { NotionRegistryStore } from "../notion/registry-store.js";
import { SqlRunner } from "../storage/sql-runner.js";
import { DirongDatabase } from "../storage/sqlite.js";
import {
  loadProductRuntimeSettings,
} from "../settings/product-settings.js";
import type { SttSettings } from "../settings/app-settings.js";
import type { NotionRuntimeSettings } from "../notion/settings.js";
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

type DoctorOptions = {
  notionRemote: boolean;
};

type NotionRegistryDiagnostics =
  | {
      exists: false;
    }
  | {
      exists: true;
      available: false;
      missingTables: string[];
    }
  | {
      exists: true;
      available: true;
      snapshot: ManagedNotionRegistrySnapshot;
      latestCheckRecord: NotionManagedSchemaCheckRecord | null;
    };

type NotionManagedSchemaCheckRecord = {
  status: string;
  severity: string;
  updatedAt: string;
  summary: string | null;
};

try {
  const options = parseDoctorOptions(process.argv.slice(2));
  const productRuntime = loadProductRuntimeSettings();
  const config = productRuntime.config;
  const health = await runHealthCheck({ config });
  const appHealthChecks = adaptHealthChecksForRecordingSttDoctor(health.checks);
  const sttChecks = await runSttReadinessChecks(productRuntime.appSettings.stt);
  const dbSummary = readDbSummary(config.dbPath, config.dbBusyTimeoutMs);
  const notionRegistry = readNotionRegistryDiagnostics(
    config.dbPath,
    config.dbBusyTimeoutMs,
  );
  const notionRemoteChecks = options.notionRemote
    ? await runNotionRemoteChecks(
        config.dbPath,
        config.dbBusyTimeoutMs,
        productRuntime.appSettings.notion,
      )
    : [];

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
  printNotionRegistryDiagnostics(notionRegistry);
  if (options.notionRemote) {
    printChecks("Notion remote managed schema", notionRemoteChecks);
  }

  console.log("");
  console.log("이 doctor는 read-only입니다. DB repair가 필요하면 npm run repair를 실행해 주세요.");
  console.log("Discord 토큰과 API key 값은 출력하지 않았습니다.");

  const failed = [...appHealthChecks, ...sttChecks, ...notionRemoteChecks].filter(
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

function parseDoctorOptions(args: string[]): DoctorOptions {
  return {
    notionRemote: args.includes("--notion-remote"),
  };
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

async function runSttReadinessChecks(
  sttSettings: SttSettings,
): Promise<HealthCheck[]> {
  const { provider, settings } = createPhase3SttProvider(sttSettings);

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
          ? "OpenAI API key 저장됨(값은 출력하지 않음)"
          : "OpenAI API key가 저장되지 않았습니다. OpenAI API 호출은 하지 않았습니다.",
        action: settings.openai.apiKey
          ? undefined
          : "설정 마법사에서 OpenAI API key를 저장하거나 local-whisper provider를 사용해 주세요.",
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

async function runNotionRemoteChecks(
  dbPath: string,
  busyTimeoutMs: number,
  notionSettings: NotionRuntimeSettings,
): Promise<HealthCheck[]> {
  const diagnostics = readNotionRegistryDiagnostics(dbPath, busyTimeoutMs);
  if (!diagnostics.exists) {
    return [
      {
        name: "managed registry",
        status: "fail",
        message: "SQLite DB가 없어 Notion managed DB를 확인할 수 없습니다.",
      },
    ];
  }
  if (!diagnostics.available) {
    return [
      {
        name: "managed registry",
        status: "fail",
        message: `Notion registry table이 없습니다: ${diagnostics.missingTables.join(", ")}`,
      },
    ];
  }

  if (!notionSettings.apiKey) {
    return [
      {
        name: "Notion API key",
        status: "fail",
        message: "Notion 연결 토큰이 저장되지 않아 remote check를 실행하지 않았습니다.",
      },
    ];
  }

  const database = new DirongDatabase(dbPath, busyTimeoutMs, { readOnly: true });
  try {
    const registryStore = new NotionRegistryStore(new SqlRunner(database));
    const service = new ManagedNotionSchemaStatusService({
      registryStore,
      client: createNotionClient({
        apiKey: notionSettings.apiKey,
        apiVersion: notionSettings.apiVersion,
        baseUrl: notionSettings.baseUrl,
        requestTimeoutMs: notionSettings.requestTimeoutMs,
      }),
    });
    const snapshot = await service.checkAll();
    return managedSchemaSnapshotToHealthChecks(snapshot);
  } catch (error) {
    return [
      {
        name: "Notion remote check",
        status: "fail",
        message: summarizeSafeError(error),
        action: "네트워크, Notion token, parent page 공유 권한을 확인해 주세요.",
      },
    ];
  } finally {
    database.close();
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

function readNotionRegistryDiagnostics(
  dbPath: string,
  busyTimeoutMs: number,
): NotionRegistryDiagnostics {
  if (!existsSync(dbPath)) {
    return { exists: false };
  }

  const rawDb = new DatabaseSync(dbPath, { readOnly: true });
  try {
    rawDb.exec(`PRAGMA busy_timeout = ${Math.trunc(busyTimeoutMs)};`);
    const requiredTables = [
      "notion_workspace_settings",
      "notion_managed_databases",
      "notion_property_mappings",
    ];
    const missingTables = requiredTables.filter(
      (tableName) => !tableExists(rawDb, tableName),
    );
    if (missingTables.length > 0) {
      return {
        exists: true,
        available: false,
        missingTables,
      };
    }
    const latestCheckRecord = readLatestNotionManagedSchemaCheckRecord(rawDb);

    const database = new DirongDatabase(dbPath, busyTimeoutMs, { readOnly: true });
    try {
      const registryStore = new NotionRegistryStore(new SqlRunner(database));
      return {
        exists: true,
        available: true,
        snapshot: readManagedNotionRegistrySnapshot(registryStore),
        latestCheckRecord,
      };
    } finally {
      database.close();
    }
  } finally {
    rawDb.close();
  }
}

function readLatestNotionManagedSchemaCheckRecord(
  db: DatabaseSync,
): NotionManagedSchemaCheckRecord | null {
  if (!tableExists(db, "repair_items")) {
    return null;
  }
  const requiredColumns = [
    "id",
    "item_type",
    "status",
    "severity",
    "details_json",
    "updated_at",
  ];
  if (
    requiredColumns.some(
      (columnName) => !tableColumnExists(db, "repair_items", columnName),
    )
  ) {
    return null;
  }
  const row = db.prepare(
    `SELECT status, severity, details_json, updated_at
     FROM repair_items
     WHERE item_type = 'notion_managed_schema'
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
  ).get() as
    | {
        status: string;
        severity: string;
        details_json: string | null;
        updated_at: string;
      }
    | undefined;
  if (!row) {
    return null;
  }
  return {
    status: row.status,
    severity: row.severity,
    updatedAt: row.updated_at,
    summary: summarizeNotionManagedSchemaDetails(row.details_json),
  };
}

function printNotionRegistryDiagnostics(
  diagnostics: NotionRegistryDiagnostics,
): void {
  console.log("[Notion managed registry]");
  if (!diagnostics.exists) {
    console.log("[WARN] SQLite DB가 없어 managed registry를 확인할 수 없습니다.");
    console.log("     remote check는 --notion-remote 옵션을 줄 때만 Notion API를 호출합니다.");
    console.log("");
    return;
  }
  if (!diagnostics.available) {
    console.log(
      `[WARN] managed registry table 없음: ${diagnostics.missingTables.join(", ")}`,
    );
    console.log("     setup wizard에서 Notion managed DB를 생성하면 registry가 저장됩니다.");
    console.log("     remote check는 --notion-remote 옵션을 줄 때만 Notion API를 호출합니다.");
    console.log("");
    return;
  }

  const { snapshot } = diagnostics;
  const statusLabel = snapshot.status === "ready" ? "OK" : "WARN";
  console.log(
    `[${statusLabel}] registry: ${snapshot.status}, DB=${snapshot.databaseCount}/${snapshot.expectedDatabaseCount}, mappings=${snapshot.propertyMappingCount}/${snapshot.expectedPropertyMappingCount}`,
  );
  if (snapshot.workspace) {
    console.log(
      `[OK] workspace: locale=${snapshot.workspace.locale}, parentPage=stored`,
    );
  }
  for (const database of snapshot.databases) {
    const databaseStatus = database.ready ? "OK" : "WARN";
    console.log(
      `[${databaseStatus}] ${database.role}: ${database.name ?? database.expectedName}, mappings=${database.mappingCount}/${database.expectedMappingCount}, schema=${database.schemaVersion ?? "missing"}`,
    );
    if (database.missingSemanticKeys.length > 0) {
      console.log(
        `     missing: ${database.missingSemanticKeys.join(", ")}`,
      );
    }
  }
  if (snapshot.actionItemUpload.status === "implemented") {
    console.log(`[OK] action item upload: ${snapshot.actionItemUpload.message}`);
  }

  if (diagnostics.latestCheckRecord) {
    const record = diagnostics.latestCheckRecord;
    console.log(
      `[${record.status === "open" ? "WARN" : "OK"}] latest managed schema check record: status=${record.status}, severity=${record.severity}, updated=${record.updatedAt}`,
    );
    if (record.summary) {
      console.log(`     ${record.summary}`);
    }
  } else {
    console.log("[OK] latest managed schema check record: local 기록 없음");
  }
  console.log("     remote check는 --notion-remote 옵션을 줄 때만 Notion API를 호출합니다.");
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

function managedSchemaSnapshotToHealthChecks(
  snapshot: ManagedNotionSchemaStatusSnapshot,
): HealthCheck[] {
  const checks: HealthCheck[] = [
    {
      name: "managed schema aggregate",
      status: managedSchemaStatusToHealthStatus(snapshot.status),
      message: `status=${snapshot.status}, checkedAt=${snapshot.checkedAt}`,
      action:
        snapshot.status === "healthy"
          ? undefined
          : "DB 설정 화면에서 복구 계획을 확인해 주세요.",
    },
  ];

  for (const database of snapshot.databases) {
    checks.push({
      name: `${database.role} data source`,
      status: managedSchemaStatusToHealthStatus(database.remote.status),
      message: [
        `status=${database.remote.status}`,
        database.remote.error ? `error=${redactSensitiveText(database.remote.error)}` : null,
        database.remote.warnings.length > 0
          ? `warnings=${database.remote.warnings.length}`
          : null,
      ]
        .filter((item): item is string => item !== null)
        .join(", "),
      action:
        database.remote.status === "healthy"
          ? undefined
          : "Notion 권한과 필수 필드/관계 상태를 확인해 주세요.",
    });
  }

  return checks;
}

function managedSchemaStatusToHealthStatus(
  status: ManagedNotionSchemaCheckStatus,
): HealthCheck["status"] {
  if (status === "healthy") {
    return "ok";
  }
  if (status === "unchecked" || status === "checking") {
    return "warn";
  }
  return "fail";
}

function summarizeNotionManagedSchemaDetails(
  detailsJson: string | null,
): string | null {
  if (!detailsJson) {
    return null;
  }
  try {
    const details = JSON.parse(detailsJson) as Record<string, unknown>;
    const role = typeof details.role === "string" ? details.role : null;
    const status = typeof details.status === "string" ? details.status : null;
    const operationCount =
      Array.isArray(details.operations) ? details.operations.length : null;
    const error = typeof details.error === "string" ? details.error : null;
    return [
      role ? `role=${role}` : null,
      status ? `remoteStatus=${status}` : null,
      operationCount !== null ? `operations=${operationCount}` : null,
      error ? `error=${redactSensitiveText(error)}` : null,
    ]
      .filter((item): item is string => item !== null)
      .join(", ") || redactSensitiveText(detailsJson).slice(0, 240);
  } catch {
    return redactSensitiveText(detailsJson).slice(0, 240);
  }
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
