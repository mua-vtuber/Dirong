import { existsSync } from "node:fs";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { printCliError } from "../cli/error-output.js";
import { redactSensitiveText, summarizeSafeError } from "../errors.js";
import { runHealthCheck, type HealthCheck } from "../health.js";
import { formatLocaleText, t } from "../i18n/catalog.js";
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
import type { DirongLocale } from "../settings/local-settings-store.js";
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
  const locale = productRuntime.setupStatus.getLocale();
  const config = productRuntime.config;
  const health = await runHealthCheck({ config, locale });
  const appHealthChecks = adaptHealthChecksForRecordingSttDoctor(
    health.checks,
    locale,
  );
  const sttChecks = await runSttReadinessChecks(
    productRuntime.appSettings.stt,
    locale,
  );
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
        locale,
      )
    : [];

  console.log(t(locale, "doctor.title"));
  console.log(`${t(locale, "doctor.generatedAtLabel")}: ${health.generatedAt}`);
  console.log(`Node.js: ${health.nodeVersion}`);
  console.log(`${t(locale, "doctor.platformLabel")}: ${health.platform} ${health.arch}`);
  console.log(`SQLite DB: ${config.dbPath}`);
  console.log(`Dashboard bind: ${config.dashboardHost}:${config.dashboardPort}`);
  console.log("");

  printChecks(t(locale, "doctor.baseEnvironmentTitle"), appHealthChecks, locale);
  printChecks("STT provider", sttChecks, locale);
  printDbSummary(dbSummary, locale);
  printNotionRegistryDiagnostics(notionRegistry, locale);
  if (options.notionRemote) {
    printChecks("Notion remote managed schema", notionRemoteChecks, locale);
  }

  console.log("");
  console.log(t(locale, "doctor.readOnlyNotice"));
  console.log(t(locale, "doctor.secretsHiddenNotice"));

  const failed = [...appHealthChecks, ...sttChecks, ...notionRemoteChecks].filter(
    (check) => check.status === "fail",
  );
  if (failed.length > 0) {
    console.log("");
    console.log(t(locale, "doctor.failureNotice"));
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
  locale: DirongLocale,
): HealthCheck[] {
  return checks.map((check) => {
    if (check.name !== "Discord voice channel ID") {
      return check;
    }

    if (check.status === "ok") {
      return {
        ...check,
        name: t(locale, "doctor.discordVoiceOptionalName"),
        message: t(locale, "doctor.discordVoiceConfiguredOptional"),
        action: undefined,
      };
    }

    return {
      ...check,
      name: t(locale, "doctor.discordVoiceOptionalName"),
      status: "ok",
      message: t(locale, "doctor.discordVoiceNotNeeded"),
      action: undefined,
    };
  });
}

async function runSttReadinessChecks(
  sttSettings: SttSettings,
  locale: DirongLocale,
): Promise<HealthCheck[]> {
  const { provider, settings } = createPhase3SttProvider(sttSettings);

  if (settings.provider === "openai") {
    return [
      {
        name: "STT provider",
        status: "ok",
        message: t(locale, "doctor.stt.openAiSelected"),
      },
      {
        name: "OpenAI API key",
        status: settings.openai.apiKey ? "ok" : "fail",
        message: settings.openai.apiKey
          ? t(locale, "doctor.stt.openAiKeyStored")
          : t(locale, "doctor.stt.openAiKeyMissing"),
        action: settings.openai.apiKey
          ? undefined
          : t(locale, "doctor.stt.openAiKeyAction"),
      },
    ];
  }

  console.log(t(locale, "doctor.stt.localWhisperLoading"));
  try {
    assertPhase3SttProviderReady({ settings, dryRun: false });
    await provider.preflight?.();
    return [
      {
        name: "STT provider",
        status: "ok",
        message: t(locale, "doctor.stt.localWhisperSelected"),
      },
      {
        name: "local-whisper readiness",
        status: "ok",
        message: formatLocaleText(locale, "doctor.stt.localWhisperReady", {
          model: provider.modelName,
          device: settings.localWhisper.device,
          computeType: settings.localWhisper.computeType,
        }),
      },
    ];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [
      {
        name: "STT provider",
        status: "ok",
        message: t(locale, "doctor.stt.localWhisperSelected"),
      },
      {
        name: "local-whisper readiness",
        status: "fail",
        message,
        action: t(locale, "doctor.stt.localWhisperAction"),
      },
    ];
  }
}

async function runNotionRemoteChecks(
  dbPath: string,
  busyTimeoutMs: number,
  notionSettings: NotionRuntimeSettings,
  locale: DirongLocale,
): Promise<HealthCheck[]> {
  const diagnostics = readNotionRegistryDiagnostics(dbPath, busyTimeoutMs);
  if (!diagnostics.exists) {
    return [
      {
        name: "managed registry",
        status: "fail",
        message: t(locale, "doctor.notion.registryNoDb"),
      },
    ];
  }
  if (!diagnostics.available) {
    return [
      {
        name: "managed registry",
        status: "fail",
        message: formatLocaleText(locale, "doctor.notion.registryMissingTables", {
          tables: diagnostics.missingTables.join(", "),
        }),
      },
    ];
  }

  if (!notionSettings.apiKey) {
    return [
      {
        name: "Notion API key",
        status: "fail",
        message: t(locale, "doctor.notion.tokenMissingRemote"),
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
    return managedSchemaSnapshotToHealthChecks(snapshot, locale);
  } catch (error) {
    return [
      {
        name: "Notion remote check",
        status: "fail",
        message: summarizeSafeError(error),
        action: t(locale, "doctor.notion.remoteCheckAction"),
      },
    ];
  } finally {
    database.close();
  }
}

function printChecks(
  title: string,
  checks: HealthCheck[],
  locale?: DirongLocale,
): void {
  console.log(`[${title}]`);
  for (const check of checks) {
    const icon = check.status === "ok" ? "[OK]" : check.status === "fail" ? "[FAIL]" : "[WARN]";
    console.log(`${icon} ${check.name}: ${check.message}`);
    if (check.action) {
      console.log(`     ${t(locale, "doctor.actionPrefix")}: ${check.action}`);
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
  locale: DirongLocale,
): void {
  console.log(`[${t(locale, "doctor.notion.registryTitle")}]`);
  if (!diagnostics.exists) {
    console.log(`[WARN] ${t(locale, "doctor.notion.registryNoDbPrint")}`);
    console.log(`     ${t(locale, "doctor.notion.remoteOnlyHint")}`);
    console.log("");
    return;
  }
  if (!diagnostics.available) {
    console.log(
      `[WARN] ${formatLocaleText(locale, "doctor.notion.registryMissingTablesPrint", {
        tables: diagnostics.missingTables.join(", "),
      })}`,
    );
    console.log(`     ${t(locale, "doctor.notion.registrySetupHint")}`);
    console.log(`     ${t(locale, "doctor.notion.remoteOnlyHint")}`);
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
    console.log(`[OK] ${t(locale, "doctor.notion.latestCheckNoRecord")}`);
  }
  console.log(`     ${t(locale, "doctor.notion.remoteOnlyHint")}`);
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

function printDbSummary(summary: DbSummary, locale: DirongLocale): void {
  console.log(`[${t(locale, "doctor.sqlite.title")}]`);
  if (!summary.exists) {
    console.log(`[WARN] ${t(locale, "doctor.sqlite.noDb")}`);
    console.log("");
    return;
  }

  console.log(
    `[OK] ${formatLocaleText(locale, "doctor.sqlite.sessions", {
      count: summary.sessions,
    })}`,
  );
  console.log(
    `[OK] ${formatLocaleText(locale, "doctor.sqlite.activeSessions", {
      count: summary.activeSessions,
    })}`,
  );
  console.log(
    `[OK] STT jobs: queued=${summary.queuedJobs}, processing=${summary.processingJobs}, done=${summary.doneJobs}, failed=${summary.failedJobs}`,
  );
  console.log(
    `[OK] ${formatLocaleText(locale, "doctor.sqlite.transcriptSegments", {
      count: summary.transcriptSegments,
      noSpeechCount: summary.noSpeechSegments,
    })}`,
  );
  console.log(
    `[${summary.openRepairItems > 0 ? "WARN" : "OK"}] ${formatLocaleText(locale, "doctor.sqlite.openRepairItems", {
      count: summary.openRepairItems,
    })}`,
  );
  console.log("");
}

function managedSchemaSnapshotToHealthChecks(
  snapshot: ManagedNotionSchemaStatusSnapshot,
  locale: DirongLocale,
): HealthCheck[] {
  const checks: HealthCheck[] = [
    {
      name: "managed schema aggregate",
      status: managedSchemaStatusToHealthStatus(snapshot.status),
      message: `status=${snapshot.status}, checkedAt=${snapshot.checkedAt}`,
      action:
        snapshot.status === "healthy"
          ? undefined
          : t(locale, "doctor.notion.managedSchemaAction"),
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
          : t(locale, "doctor.notion.dataSourceAction"),
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
