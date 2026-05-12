import type { Phase1Config } from "../config.js";
import { redactForJson, summarizeSafeError } from "../errors.js";
import {
  buildHumanStatusDisplay,
  type HumanStatusDisplay,
  type HumanStatusDisplayInput,
} from "../messages/human-status.js";
import {
  createNotionClient,
  NotionApiError,
  type NotionClient,
} from "./client.js";
import { NotionDraftInputReadModel } from "./draft-input-read-model.js";
import type {
  NotionRuntimeSettings,
  NotionRuntimeSettingsProvider,
} from "./settings.js";
import { snapshotNotionRuntimeSettings } from "./settings.js";
import {
  buildNotionCustomPropertyPrompt,
  NotionCustomPropertyRuleStore,
  SUPPORTED_NOTION_CUSTOM_PROPERTY_TYPES,
  type NotionCustomPropertyRule,
  type NotionCustomPropertyRuleInput,
  withDefaultNotionMemberRelationRule,
} from "./property-rules.js";
import {
  buildNotionSchemaDiff,
  buildNotionSchemaUpdatePlan,
  type NotionSchemaApplyOptions,
  type NotionSchemaDiff,
} from "./schema-manager.js";
import { parseNotionPageUrl, parseNotionTargetUrl } from "./target.js";
import {
  runNotionUpload,
  type NotionDraftSelector,
} from "./writer.js";
import {
  syncNotionMemberRoster,
  type NotionMemberRosterSyncResult,
} from "./member-roster-sync.js";
import {
  NotionMemberRosterStore,
  type NotionMemberRosterStoredWarning,
  type NotionMemberRosterSyncStatus,
} from "./member-roster-store.js";
import { hasCompleteManagedNotionUploadRegistry } from "./managed-registry-policy.js";
import {
  readDataSourceProperties,
  readDataSources,
  readId,
} from "./data-source-readers.js";
import {
  applyRetentionAfterSuccessfulUpload,
  type NotionUploadRetentionHandler,
} from "./upload-retention.js";
import {
  readManagedNotionRegistrySnapshot,
  type ManagedNotionRegistrySnapshot,
} from "./managed-registry.js";
import {
  ManagedNotionSchemaStatusService,
  type ManagedNotionSchemaStatusSnapshot,
} from "./managed-schema-status.js";
import {
  applyManagedSchemaRepair,
  buildManagedSchemaRepairPlan,
  ManagedSchemaRepairStalePlanError,
  type ManagedSchemaRepairPlan,
  type ManagedSchemaRepairResult,
} from "./managed-schema-repair.js";
import {
  KOREAN_NOTION_SCHEMA_PRESET,
  NOTION_DATABASE_ROLES,
  type NotionDatabaseRole,
} from "./schema-presets.js";
import { NotionRegistryStore } from "./registry-store.js";
import { NotionWriteStore } from "./write-store.js";
import { SqlRunner } from "../storage/sql-runner.js";
import type { DirongDatabase } from "../storage/sqlite.js";

export type NotionCustomPropertiesRoleSnapshot = {
  supportedTypes: readonly string[];
  requiredPropertyNames: string[];
  rules: NotionCustomPropertyRule[];
  enabledCount: number;
  promptPreview: string;
  message: string;
  userAction: string | null;
};

export type NotionCustomPropertiesDashboardSnapshot =
  NotionCustomPropertiesRoleSnapshot & {
    roles: Record<NotionDatabaseRole, NotionCustomPropertiesRoleSnapshot>;
  };

export type NotionDashboardSnapshot = {
  enabled: boolean;
  configured: boolean;
  status: "disabled" | "not_configured" | "ready" | "blocked";
  uploadMode: string;
  targetUrl: string | null;
  message: string;
  userAction: string | null;
  display?: HumanStatusDisplay;
  managedRegistry?: ManagedNotionRegistrySnapshot;
  memberRoster: NotionMemberRosterDashboardSnapshot;
  settings: ReturnType<typeof snapshotNotionRuntimeSettings>;
  customProperties: NotionCustomPropertiesDashboardSnapshot;
};

export type NotionMemberRosterDashboardSnapshot = {
  dataSourceId: string | null;
  status: NotionMemberRosterSyncStatus | "not_synced" | "not_configured";
  syncedAt: string | null;
  memberCount: number;
  roleCount: number;
  warningCount: number;
  warnings: NotionMemberRosterStoredWarning[];
  lastError: string | null;
};

export type NotionDashboardActionInput = {
  sessionId: string | null;
  draftId: string | null;
  force: boolean;
};

export type NotionDashboardActionResult = {
  ok: boolean;
  status: string;
  message: string;
  userAction: string | null;
  display?: HumanStatusDisplay;
  technicalDetail?: string | null;
  pageUrl: string | null;
};

export type NotionDashboardCustomPropertyActionResult = {
  ok: boolean;
  status: string;
  message: string;
  userAction: string | null;
  warnings: string[];
  customProperties: NotionCustomPropertiesDashboardSnapshot;
};

export type NotionDashboardSchemaActionResult = {
  ok: boolean;
  status: string;
  message: string;
  userAction: string | null;
  warnings: string[];
  diff: NotionSchemaDiff | null;
  operations: {
    create: number;
    rename: number;
    updateType: number;
    updateOptions: number;
    delete: number;
  } | null;
};

export type NotionDashboardManagedSchemaCheckResult = {
  ok: boolean;
  status: string;
  message: string;
  userAction: string | null;
  snapshot: ManagedNotionSchemaStatusSnapshot;
  plans: Record<NotionDatabaseRole, ManagedSchemaRepairPlan>;
};

export type NotionDashboardManagedSchemaRepairInput = {
  role: NotionDatabaseRole;
  confirm: boolean;
  expectedPlanHash: string;
  operations?: readonly string[];
};

export type NotionDashboardManagedSchemaRepairResult =
  ManagedSchemaRepairResult & {
    snapshot: ManagedNotionSchemaStatusSnapshot;
  };

export class NotionDashboardService {
  private readonly runner: SqlRunner;
  private readonly propertyRuleStore: NotionCustomPropertyRuleStore;
  private readonly registryStore: NotionRegistryStore;
  private readonly memberRosterStore: NotionMemberRosterStore;
  private lastManagedSchemaCheck: ManagedNotionSchemaStatusSnapshot | null = null;

  constructor(
    private readonly input: {
      settings: NotionRuntimeSettings;
      getSettings?: NotionRuntimeSettingsProvider;
      notionClientFactory?: (
        settings: NotionRuntimeSettings,
      ) => NotionClient | null;
      database: DirongDatabase;
      config: Pick<Phase1Config, "sttLeaseMs">;
      workerId: string;
      retention?: NotionUploadRetentionHandler;
    },
  ) {
    this.runner = new SqlRunner(input.database);
    this.propertyRuleStore = new NotionCustomPropertyRuleStore(this.runner);
    this.registryStore = new NotionRegistryStore(this.runner);
    this.memberRosterStore = new NotionMemberRosterStore(this.runner);
  }

  private getSettings(): NotionRuntimeSettings {
    return this.input.getSettings?.() ?? this.input.settings;
  }

  private recordManagedSchemaRepairItem(input: {
    role: NotionDatabaseRole;
    status: "open" | "repaired";
    severity: "info" | "warn" | "error";
    details: unknown;
  }): void {
    const nowIso = new Date().toISOString();
    this.runner.run(
      `INSERT INTO repair_items (
         dedupe_key, session_id, item_type, status, severity, path,
         chunk_id, stt_job_id, details_json, created_at, updated_at
       ) VALUES (?, NULL, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?)
       ON CONFLICT(dedupe_key) DO UPDATE SET
         status = excluded.status,
         severity = excluded.severity,
         details_json = excluded.details_json,
         updated_at = excluded.updated_at,
         resolved_at = CASE
           WHEN excluded.status IN ('repaired', 'ignored') THEN excluded.updated_at
           ELSE repair_items.resolved_at
         END`,
      `notion_managed_schema:${input.role}`,
      "notion_managed_schema",
      input.status,
      input.severity,
      JSON.stringify(redactForJson({ role: input.role, ...asRecord(input.details) })),
      nowIso,
      nowIso,
    );
  }

  getSnapshot(): NotionDashboardSnapshot {
    const settings = this.getSettings();
    const managedRegistry = readManagedNotionRegistrySnapshot(this.registryStore, {
      remoteCheck: this.lastManagedSchemaCheck,
    });
    const memberRoster = this.getMemberRosterSnapshot();
    const configured = Boolean(
      settings.apiKey &&
        (settings.targetUrl ||
          hasCompleteManagedNotionUploadRegistry(this.registryStore)),
    );
    const customProperties = this.getCustomPropertiesSnapshot();
    if (!settings.enabled) {
      const message = "Notion upload is disabled.";
      const userAction = "NOTION_EXPORT_ENABLED=true로 켤 수 있습니다.";
      return {
        enabled: false,
        configured,
        status: "disabled",
        uploadMode: settings.uploadMode,
        targetUrl: settings.targetUrl,
        message,
        userAction,
        display: buildNotionDashboardDisplay({
          status: "disabled",
          message,
          userAction,
          uploadMode: settings.uploadMode,
          targetUrl: settings.targetUrl,
        }),
        managedRegistry,
        memberRoster,
        settings: snapshotNotionRuntimeSettings(settings),
        customProperties,
      };
    }
    if (managedRegistry.status === "partial") {
      const message = "Notion managed DB registry가 일부만 저장되어 업로드를 막았습니다.";
      const userAction =
        "기존 DB/필드를 자동 수정하지 않습니다. Notion 설정/복구 화면에서 registry 상태를 확인해 주세요.";
      return {
        enabled: true,
        configured: false,
        status: "blocked",
        uploadMode: settings.uploadMode,
        targetUrl: settings.targetUrl,
        message,
        userAction,
        display: buildNotionDashboardDisplay({
          status: "blocked",
          message,
          userAction,
          uploadMode: settings.uploadMode,
          targetUrl: settings.targetUrl,
          managedRegistry,
        }),
        managedRegistry,
        memberRoster,
        settings: snapshotNotionRuntimeSettings(settings),
        customProperties,
      };
    }
    if (!configured) {
      const message = "Notion upload settings are incomplete.";
      const userAction =
        "Notion token과 parent page URL을 저장한 뒤 managed DB 세트를 생성해 주세요.";
      return {
        enabled: true,
        configured: false,
        status: "not_configured",
        uploadMode: settings.uploadMode,
        targetUrl: settings.targetUrl,
        message,
        userAction,
        display: buildNotionDashboardDisplay({
          status: "not_configured",
          message,
          userAction,
          uploadMode: settings.uploadMode,
          targetUrl: settings.targetUrl,
          managedRegistry,
        }),
        managedRegistry,
        memberRoster,
        settings: snapshotNotionRuntimeSettings(settings),
        customProperties,
      };
    }
    const message = "Notion upload is configured.";
    return {
      enabled: true,
      configured: true,
      status: "ready",
      uploadMode: settings.uploadMode,
      targetUrl: settings.targetUrl,
      message,
      userAction: null,
      display: buildNotionDashboardDisplay({
        status: "ready",
        message,
        userAction: null,
        uploadMode: settings.uploadMode,
        targetUrl: settings.targetUrl,
        managedRegistry,
      }),
      managedRegistry,
      memberRoster,
      settings: snapshotNotionRuntimeSettings(settings),
      customProperties,
    };
  }

  async checkManagedSchema(): Promise<ManagedNotionSchemaStatusSnapshot> {
    const settings = this.getSettings();
    if (!settings.apiKey) {
      throw new Error("Notion token이 설정된 뒤 managed DB 상태를 확인할 수 있습니다.");
    }
    const client = this.createClient(settings);
    if (!client) {
      throw new Error("Notion client를 만들 수 없습니다. token 설정을 확인해 주세요.");
    }
    const service = new ManagedNotionSchemaStatusService({
      client,
      registryStore: this.registryStore,
    });
    this.lastManagedSchemaCheck = await service.checkAll();
    return this.lastManagedSchemaCheck;
  }

  async checkManagedSchemaWithPlans(): Promise<NotionDashboardManagedSchemaCheckResult> {
    const snapshot = await this.checkManagedSchema();
    const mappings = this.registryStore.listPropertyMappings();
    const managedDatabases = this.registryStore.listManagedDatabases();
    const plans = Object.fromEntries(
      snapshot.databases.map((database) => [
        database.role,
        database.remote.diff
          ? buildManagedSchemaRepairPlan({
              role: database.role,
              diff: database.remote.diff,
              mappings,
              managedDatabases,
            })
          : emptyManagedSchemaRepairPlan(database.role),
      ]),
    ) as Record<NotionDatabaseRole, ManagedSchemaRepairPlan>;
    return {
      ok: snapshot.status !== "failed",
      status: snapshot.status,
      message: managedSchemaCheckMessage(snapshot.status),
      userAction:
        snapshot.status === "healthy"
          ? null
          : "복구 계획을 확인한 뒤 적용할 항목을 선택해 주세요.",
      snapshot,
      plans,
    };
  }

  async repairManagedSchema(
    input: NotionDashboardManagedSchemaRepairInput,
  ): Promise<NotionDashboardManagedSchemaRepairResult> {
    if (!input.confirm) {
      throw new Error("managed schema repair에는 confirm=true가 필요합니다.");
    }
    const settings = this.getSettings();
    if (!settings.apiKey) {
      throw new Error("Notion token이 설정된 뒤 managed DB를 복구할 수 있습니다.");
    }
    const client = this.createClient(settings);
    if (!client) {
      throw new Error("Notion client를 만들 수 없습니다. token 설정을 확인해 주세요.");
    }

    try {
      const result = await applyManagedSchemaRepair({
        client,
        registryStore: this.registryStore,
        role: input.role,
        expectedPlanHash: input.expectedPlanHash,
        operationIds: input.operations,
      });
      this.recordManagedSchemaRepairItem({
        role: input.role,
        status: result.ok ? "repaired" : "open",
        severity: result.ok ? "info" : "warn",
        details: result,
      });
      this.lastManagedSchemaCheck = await new ManagedNotionSchemaStatusService({
        client,
        registryStore: this.registryStore,
      }).checkAll();
      return {
        ...result,
        snapshot: this.lastManagedSchemaCheck,
      };
    } catch (error) {
      if (error instanceof ManagedSchemaRepairStalePlanError) {
        throw error;
      }
      this.recordManagedSchemaRepairItem({
        role: input.role,
        status: "open",
        severity: "error",
        details: { error: summarizeSafeError(error) },
      });
      throw error;
    }
  }

  async runManualUpload(
    action: NotionDashboardActionInput,
  ): Promise<NotionDashboardActionResult> {
    const selector = selectorFromAction(action);
    if (!selector) {
      return {
        ok: false,
        status: "failed",
        message: "sessionId 또는 draftId가 필요합니다.",
        userAction: "회의 세션이나 draft가 생긴 뒤 다시 시도해 주세요.",
        pageUrl: null,
      };
    }

    const settings = this.getSettings();
    const client = this.createClient(settings);
    const result = await runNotionUpload({
      settings,
      selector,
      dryRun: false,
      force: action.force,
      workerId: this.input.workerId,
      leaseMs: settings.leaseMs || this.input.config.sttLeaseMs,
      client,
      readModel: new NotionDraftInputReadModel(this.runner),
      writeStore: new NotionWriteStore(this.runner),
      registryStore: this.registryStore,
      memberRosterStore: this.memberRosterStore,
      customPropertyRules: this.propertyRuleStore.listEnabledRules("meeting"),
    });
    try {
      await applyRetentionAfterSuccessfulUpload(this.input.retention, result);
    } catch (error) {
      return {
        ok: false,
        status: "failed",
        message: "Notion 업로드 후 보관 정책 적용 중 오류가 발생했습니다.",
        userAction:
          "로컬 파일 경로와 데이터 폴더 설정을 확인한 뒤 다시 시도해 주세요.",
        display: buildNotionUploadActionDisplay({
          status: "failed",
          message: "Notion 업로드 후 보관 정책 적용 중 오류가 발생했습니다.",
          userAction:
            "로컬 파일 경로와 데이터 폴더 설정을 확인한 뒤 다시 시도해 주세요.",
          technicalDetail: summarizeSafeError(error),
          details: [
            { label: "sessionId", value: result.sessionId },
            { label: "draftId", value: result.draftId },
            { label: "targetId", value: result.targetId },
            { label: "writeId", value: result.writeId },
            { label: "pageId", value: result.pageId },
            { label: "contentHash", value: result.contentHash },
            { label: "warnings", value: result.warnings },
          ],
        }),
        technicalDetail: summarizeSafeError(error),
        pageUrl: result.pageUrl,
      };
    }

    return {
      ok: ["done", "retry_wait", "not_claimed"].includes(result.status),
      status: result.status,
      message: result.message,
      userAction: result.userAction,
      display: buildNotionUploadActionDisplay({
        status: result.status,
        message: result.message,
        userAction: result.userAction,
        technicalDetail: result.technicalDetail,
        details: [
          { label: "sessionId", value: result.sessionId },
          { label: "draftId", value: result.draftId },
          { label: "targetId", value: result.targetId },
          { label: "writeId", value: result.writeId },
          { label: "pageId", value: result.pageId },
          { label: "contentHash", value: result.contentHash },
          { label: "warnings", value: result.warnings },
        ],
      }),
      technicalDetail: result.technicalDetail,
      pageUrl: result.pageUrl,
    };
  }

  async syncMemberRoster(): Promise<NotionMemberRosterSyncResult> {
    const settings = this.getSettings();
    if (!settings.enabled || !settings.apiKey) {
      return {
        ok: false,
        status: "not_configured",
        messageKey: "dashboard.db.memberRoster.status.notConfigured",
        userActionKey: "dashboard.db.memberRoster.action.configureNotion",
        dataSourceId: null,
        syncedAt: null,
        memberCount: 0,
        roleCount: 0,
        warnings: [],
      };
    }

    const client = this.createClient(settings);
    if (!client) {
      return {
        ok: false,
        status: "not_configured",
        messageKey: "dashboard.db.memberRoster.status.notConfigured",
        userActionKey: "dashboard.db.memberRoster.action.configureNotion",
        dataSourceId: null,
        syncedAt: null,
        memberCount: 0,
        roleCount: 0,
        warnings: [],
      };
    }

    try {
      return await syncNotionMemberRoster({
        client,
        registryStore: this.registryStore,
        rosterStore: this.memberRosterStore,
      });
    } catch (error) {
      const memberDatabase = this.registryStore.getManagedDatabase("member");
      if (memberDatabase) {
        this.memberRosterStore.recordSyncSnapshot({
          dataSourceId: memberDatabase.dataSourceId,
          status: "failed",
          memberCount: 0,
          warningCount: 0,
          lastError: summarizeSafeError(error),
          nowIso: new Date().toISOString(),
        });
      }
      return {
        ok: false,
        status: "failed",
        messageKey: "dashboard.db.memberRoster.status.failed",
        userActionKey: "dashboard.db.memberRoster.action.checkMemberDb",
        dataSourceId: memberDatabase?.dataSourceId ?? null,
        syncedAt: null,
        memberCount: 0,
        roleCount: 0,
        warnings: [],
      };
    }
  }

  async syncCustomProperties(input: {
    role: NotionDatabaseRole;
  }): Promise<NotionDashboardCustomPropertyActionResult> {
    const settings = this.getSettings();
    if (!settings.enabled || !settings.apiKey) {
      return this.customPropertyActionResult({
        ok: false,
        status: "not_configured",
        message: "Notion 설정이 완료된 뒤 속성 스키마를 불러올 수 있습니다.",
        userAction: "Notion token과 managed DB 설정을 확인해 주세요.",
      });
    }

    const client = this.createClient(settings);
    if (!client) {
      return this.customPropertyActionResult({
        ok: false,
        status: "not_configured",
        message: "Notion client를 만들 수 없습니다.",
        userAction: "Notion token과 managed DB 설정을 확인해 주세요.",
      });
    }
    const target = await this.loadCustomPropertyDataSource({
      client,
      settings,
      role: input.role,
    });
    if (!target.ok) {
      return this.customPropertyActionResult({
        ok: false,
        status: "not_configured",
        message: target.message,
        userAction: target.userAction,
      });
    }

    try {
      const syncResult = this.propertyRuleStore.syncDataSourceProperties({
        databaseRole: input.role,
        properties: readDataSourceProperties(target.dataSource),
        requiredPropertyNames: this.requiredCustomPropertyNamesForRole(
          input.role,
          settings,
        ),
        nowIso: new Date().toISOString(),
      });
      return this.customPropertyActionResult({
        ok: true,
        status: "done",
        message: `Notion 속성 ${syncResult.discovered}개를 확인했고 사용자 속성 ${syncResult.custom}개를 관리 목록에 반영했습니다.`,
        userAction: null,
      });
    } catch (error) {
      return this.customPropertyActionResult({
        ok: false,
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
        userAction:
          error instanceof NotionApiError
            ? error.userAction
            : "Notion 연결과 target 공유 상태를 확인해 주세요.",
      });
    }
  }

  saveCustomPropertyRules(
    input: {
      role: NotionDatabaseRole;
      rules: readonly NotionCustomPropertyRuleInput[];
    },
  ): NotionDashboardCustomPropertyActionResult {
    const result = this.propertyRuleStore.saveRules({
      databaseRole: input.role,
      rules: input.rules,
      requiredPropertyNames: this.requiredCustomPropertyNamesForRole(
        input.role,
        this.getSettings(),
      ),
      nowIso: new Date().toISOString(),
    });
    return this.customPropertyActionResult({
      ok: true,
      status: "done",
      message: `Notion 사용자 속성 규칙 ${result.saved}개를 저장하고 ${result.deleted}개를 삭제했습니다.`,
      userAction:
        result.ignored > 0
          ? `${result.ignored}개 항목은 필수 속성이거나 이름이 비어 있어 건너뛰었습니다.`
          : null,
      warnings: result.warnings,
    });
  }

  async inspectSchema(): Promise<NotionDashboardSchemaActionResult> {
    const context = await this.loadSchemaContext();
    if (!context.ok) {
      return context.result;
    }
    return {
      ok: true,
      status: "done",
      message: formatSchemaDiffMessage(context.diff),
      userAction: schemaDiffUserAction(context.diff),
      warnings: context.diff.warnings,
      diff: context.diff,
      operations: null,
    };
  }

  async applySchema(
    options: NotionSchemaApplyOptions,
  ): Promise<NotionDashboardSchemaActionResult> {
    const context = await this.loadSchemaContext();
    if (!context.ok) {
      return context.result;
    }

    const plan = buildNotionSchemaUpdatePlan(context.diff, options);
    if (!plan.body) {
      return {
        ok: plan.blocked.length === 0,
        status: plan.blocked.length > 0 ? "blocked" : "done",
        message:
          plan.blocked.length > 0
            ? "자동 적용할 수 없는 Notion schema 항목이 있습니다."
            : "Notion schema에 적용할 변경이 없습니다.",
        userAction:
          plan.blocked.length > 0
            ? plan.blocked.join(" ")
            : schemaDiffUserAction(context.diff),
        warnings: [...plan.warnings, ...plan.blocked],
        diff: context.diff,
        operations: plan.operations,
      };
    }

    try {
      const updated = await context.client.updateDataSource(context.target.id, plan.body);
      const properties = readDataSourceProperties(updated);
      if (Object.keys(properties).length > 0) {
        this.propertyRuleStore.syncDataSourceProperties({
          databaseRole: "meeting",
          properties,
          requiredPropertyNames: this.requiredCustomPropertyNamesForRole(
            "meeting",
            context.settings,
          ),
          nowIso: new Date().toISOString(),
        });
      }
      const after = Object.keys(properties).length > 0
        ? buildNotionSchemaDiff({
            properties,
            propertyNames: context.settings.propertyNames,
            customRules: (
              await resolveRelationRuleTargets(
                context.client,
                this.propertyRuleStore.listRules("meeting"),
              )
            ).rules,
          })
        : context.diff;
      return {
        ok: plan.blocked.length === 0,
        status: plan.blocked.length > 0 ? "partial" : "done",
        message: formatSchemaApplyMessage(plan.operations),
        userAction:
          plan.blocked.length > 0
            ? plan.blocked.join(" ")
            : schemaDiffUserAction(after),
        warnings: [...plan.warnings, ...plan.blocked],
        diff: after,
        operations: plan.operations,
      };
    } catch (error) {
      return {
        ok: false,
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
        userAction:
          error instanceof NotionApiError
            ? error.userAction
            : "Notion 연결과 target 공유 상태를 확인해 주세요.",
        warnings: plan.warnings,
        diff: context.diff,
        operations: plan.operations,
      };
    }
  }

  private customPropertyActionResult(input: {
    ok: boolean;
    status: string;
    message: string;
    userAction: string | null;
    warnings?: string[];
  }): NotionDashboardCustomPropertyActionResult {
    return {
      ...input,
      warnings: input.warnings ?? [],
      customProperties: this.getCustomPropertiesSnapshot(),
    };
  }

  private getCustomPropertiesSnapshot(): NotionCustomPropertiesDashboardSnapshot {
    const roles = Object.fromEntries(
      NOTION_DATABASE_ROLES.map((role) => [
        role,
        this.getCustomPropertiesRoleSnapshot(role),
      ]),
    ) as Record<NotionDatabaseRole, NotionCustomPropertiesRoleSnapshot>;
    return {
      ...roles.meeting,
      roles,
    };
  }

  private getMemberRosterSnapshot(): NotionMemberRosterDashboardSnapshot {
    const memberDatabase = this.registryStore.getManagedDatabase("member");
    if (!memberDatabase) {
      return {
        dataSourceId: null,
        status: "not_configured",
        syncedAt: null,
        memberCount: 0,
        roleCount: 0,
        warningCount: 0,
        warnings: [],
        lastError: null,
      };
    }

    const sync = this.memberRosterStore.getSyncSnapshot(
      memberDatabase.dataSourceId,
    );
    if (!sync) {
      return {
        dataSourceId: memberDatabase.dataSourceId,
        status: "not_synced",
        syncedAt: null,
        memberCount: 0,
        roleCount: 0,
        warningCount: 0,
        warnings: [],
        lastError: null,
      };
    }

    const entries = this.memberRosterStore.listForDataSource(
      memberDatabase.dataSourceId,
    );
    return {
      dataSourceId: memberDatabase.dataSourceId,
      status: sync.status,
      syncedAt: sync.syncedAt,
      memberCount: sync.memberCount,
      roleCount: countRosterRoles(entries),
      warningCount: sync.warningCount,
      warnings: sync.warnings,
      lastError: sync.lastError,
    };
  }

  private getCustomPropertiesRoleSnapshot(
    role: NotionDatabaseRole,
  ): NotionCustomPropertiesRoleSnapshot {
    const storedRules = this.propertyRuleStore.listRules(role);
    const rules = role === "meeting"
      ? withDefaultNotionMemberRelationRule(storedRules)
      : storedRules;
    const enabledCount = rules.filter(
      (rule) => rule.enabled && ruleHasOutput(rule),
    ).length;
    const promptPreview = role === "meeting"
      ? buildNotionCustomPropertyPrompt(rules)
      : "";
    return {
      supportedTypes: SUPPORTED_NOTION_CUSTOM_PROPERTY_TYPES,
      requiredPropertyNames: this.requiredCustomPropertyNamesForRole(
        role,
        this.getSettings(),
      ),
      rules,
      enabledCount,
      promptPreview,
      message:
        storedRules.length === 0
          ? role === "meeting"
            ? "기본 Members relation 규칙이 준비되어 있습니다. 대상 DB URL을 입력해 주세요."
            : "이 DB의 사용자 속성 규칙은 아직 없습니다."
          : `사용자 속성 ${rules.length}개 중 ${enabledCount}개가 켜져 있습니다.`,
      userAction:
        role === "meeting" && storedRules.length === 0
          ? "Members DB를 만들고 대상 DB/data source URL을 입력한 뒤 저장해 주세요."
          : null,
    };
  }

  private requiredCustomPropertyNamesForRole(
    role: NotionDatabaseRole,
    settings: NotionRuntimeSettings,
  ): string[] {
    if (role === "meeting" && !this.registryStore.getManagedDatabase("meeting")) {
      return Object.values(settings.propertyNames);
    }
    const names = new Set<string>();
    for (const mapping of this.registryStore.listPropertyMappings(role)) {
      names.add(mapping.propertyName);
    }
    for (const property of KOREAN_NOTION_SCHEMA_PRESET.databases[role].properties) {
      names.add(property.name);
    }
    return [...names];
  }

  private async loadCustomPropertyDataSource(input: {
    client: NotionClient;
    settings: NotionRuntimeSettings;
    role: NotionDatabaseRole;
  }): Promise<
    | { ok: true; dataSource: Record<string, unknown> }
    | { ok: false; message: string; userAction: string }
  > {
    const managedDatabase = this.registryStore.getManagedDatabase(input.role);
    if (managedDatabase) {
      return {
        ok: true,
        dataSource: await input.client.retrieveDataSource(
          managedDatabase.dataSourceId,
        ),
      };
    }
    if (input.role !== "meeting") {
      return {
        ok: false,
        message: "선택한 managed DB 연결 정보가 없습니다.",
        userAction: "Notion 설정에서 managed DB 세트를 먼저 생성해 주세요.",
      };
    }
    if (!input.settings.targetUrl) {
      return {
        ok: false,
        message: "Notion target URL is missing.",
        userAction: "Notion target URL 또는 managed DB 설정을 확인해 주세요.",
      };
    }
    const parsedTarget = parseNotionTargetUrl(input.settings.targetUrl);
    if (parsedTarget.kind === "invalid") {
      return {
        ok: false,
        message: "Notion target URL is invalid.",
        userAction: "Notion 데이터베이스 또는 data source URL을 다시 복사해 붙여넣어 주세요.",
      };
    }
    return {
      ok: true,
      dataSource: await resolveDataSource(input.client, parsedTarget),
    };
  }

  private async loadSchemaContext(): Promise<
    | {
        ok: true;
        client: NotionClient;
        target: { id: string; dataSource: Record<string, unknown> };
        settings: NotionRuntimeSettings;
        diff: NotionSchemaDiff;
      }
    | { ok: false; result: NotionDashboardSchemaActionResult }
  > {
    const settings = this.getSettings();
    if (!settings.enabled || !settings.apiKey || !settings.targetUrl) {
      return {
        ok: false,
        result: schemaActionErrorResult({
          status: "not_configured",
          message: "Notion 설정이 완료된 뒤 schema를 정리할 수 있습니다.",
          userAction: "NOTION_API_KEY와 NOTION_TARGET_URL을 확인해 주세요.",
        }),
      };
    }

    const parsedTarget = parseNotionTargetUrl(settings.targetUrl);
    if (parsedTarget.kind === "invalid") {
      return {
        ok: false,
        result: schemaActionErrorResult({
          status: "not_configured",
          message: "Notion target URL is invalid.",
          userAction: "Notion 데이터베이스 또는 data source URL을 다시 복사해 붙여넣어 주세요.",
        }),
      };
    }

    const client = this.createClient(settings);
    if (!client) {
      return {
        ok: false,
        result: schemaActionErrorResult({
          status: "not_configured",
          message: "Notion client를 만들 수 없습니다.",
          userAction: "NOTION_API_KEY 설정을 확인해 주세요.",
        }),
      };
    }

    try {
      const target = await resolveDataSourceTarget(client, parsedTarget);
      const relationResolution = await resolveRelationRuleTargets(
        client,
        this.propertyRuleStore.listRules("meeting"),
      );
      const diff = buildNotionSchemaDiff({
        properties: readDataSourceProperties(target.dataSource),
        propertyNames: settings.propertyNames,
        customRules: relationResolution.rules,
      });
      if (relationResolution.warnings.length > 0) {
        diff.warnings.push(...relationResolution.warnings);
      }
      return { ok: true, client, target, settings, diff };
    } catch (error) {
      return {
        ok: false,
        result: schemaActionErrorResult({
          status: "failed",
          message: error instanceof Error ? error.message : String(error),
          userAction:
            error instanceof NotionApiError
              ? error.userAction
              : "Notion 연결과 target 공유 상태를 확인해 주세요.",
        }),
      };
    }
  }

  private createClient(settings: NotionRuntimeSettings): NotionClient | null {
    if (this.input.notionClientFactory) {
      return this.input.notionClientFactory(settings);
    }
    return settings.apiKey
      ? createNotionClient({
          apiKey: settings.apiKey,
          apiVersion: settings.apiVersion,
          baseUrl: settings.baseUrl,
          requestTimeoutMs: settings.requestTimeoutMs,
        })
      : null;
  }
}

async function resolveRelationRuleTargets(
  client: NotionClient,
  rules: readonly NotionCustomPropertyRule[],
): Promise<{ rules: NotionCustomPropertyRule[]; warnings: string[] }> {
  const warnings: string[] = [];
  const resolved: NotionCustomPropertyRule[] = [];
  for (const rule of rules) {
    if (rule.propertyType !== "relation") {
      resolved.push(rule);
      continue;
    }
    let nextRule = rule;
    if (rule.relationTargetPageUrl && !rule.relationTargetPageId) {
      const parsedPage = parseNotionPageUrl(rule.relationTargetPageUrl);
      if (parsedPage.kind === "page_id") {
        nextRule = { ...nextRule, relationTargetPageId: parsedPage.id };
      } else {
        warnings.push(`${rule.propertyName}: relation 대상 page URL을 읽지 못했습니다.`);
      }
    }
    if (!rule.relationTargetUrl) {
      resolved.push(nextRule);
      continue;
    }
    const parsed = parseNotionTargetUrl(rule.relationTargetUrl);
    if (parsed.kind === "invalid") {
      warnings.push(`${rule.propertyName}: relation 대상 URL을 읽지 못했습니다.`);
      resolved.push(nextRule);
      continue;
    }
    try {
      const target = await resolveDataSourceTarget(client, parsed);
      resolved.push({ ...nextRule, relationDataSourceId: target.id });
    } catch (error) {
      warnings.push(
        `${rule.propertyName}: relation 대상 DB에 접근하지 못했습니다 (${error instanceof Error ? error.message : String(error)}).`,
      );
      resolved.push(nextRule);
    }
  }
  return { rules: resolved, warnings };
}

function ruleHasOutput(rule: NotionCustomPropertyRule): boolean {
  if (rule.valueSource === "participants") {
    return true;
  }
  if (rule.promptDescription.trim().length > 0) {
    return true;
  }
  if (rule.propertyType !== "relation") {
    return false;
  }
  if (rule.relationTargetPageId) {
    return true;
  }
  return rule.relationTargetPageUrl
    ? parseNotionPageUrl(rule.relationTargetPageUrl).kind === "page_id"
    : false;
}

function selectorFromAction(
  action: NotionDashboardActionInput,
): NotionDraftSelector | null {
  if (action.draftId) {
    return { kind: "draft", draftId: action.draftId };
  }
  if (action.sessionId) {
    return { kind: "session", sessionId: action.sessionId };
  }
  return null;
}

async function resolveDataSource(
  client: NotionClient,
  parsedTarget: Exclude<ReturnType<typeof parseNotionTargetUrl>, { kind: "invalid" }>,
): Promise<Record<string, unknown>> {
  return (await resolveDataSourceTarget(client, parsedTarget)).dataSource;
}

async function resolveDataSourceTarget(
  client: NotionClient,
  parsedTarget: Exclude<ReturnType<typeof parseNotionTargetUrl>, { kind: "invalid" }>,
): Promise<{ id: string; dataSource: Record<string, unknown> }> {
  if (parsedTarget.kind === "data_source_id") {
    return {
      id: parsedTarget.id,
      dataSource: await client.retrieveDataSource(parsedTarget.id),
    };
  }

  const database = await client.retrieveDatabase(parsedTarget.id);
  const dataSources = readDataSources(database);
  if (dataSources.length !== 1) {
    throw new Error("Notion database must contain exactly one child data source.");
  }
  const dataSourceId = readId(dataSources[0]);
  if (!dataSourceId) {
    throw new Error("Notion data source id is missing.");
  }
  return {
    id: dataSourceId,
    dataSource: await client.retrieveDataSource(dataSourceId),
  };
}

function schemaActionErrorResult(input: {
  status: string;
  message: string;
  userAction: string | null;
}): NotionDashboardSchemaActionResult {
  return {
    ok: false,
    status: input.status,
    message: input.message,
    userAction: input.userAction,
    warnings: [],
    diff: null,
    operations: null,
  };
}

function emptyManagedSchemaRepairPlan(
  role: NotionDatabaseRole,
): ManagedSchemaRepairPlan {
  return {
    role,
    status: "empty",
    planHash: "",
    operations: [],
    blocked: [],
    warnings: [],
    body: null,
  };
}

function managedSchemaCheckMessage(status: string): string {
  if (status === "healthy") {
    return "Managed Notion schema가 마지막 확인 기준으로 정상입니다.";
  }
  if (status === "needs_repair") {
    return "Managed Notion schema에 자동 복구 가능한 항목이 있습니다.";
  }
  if (status === "manual_required") {
    return "Managed Notion schema에 수동 확인이 필요한 항목이 있습니다.";
  }
  if (status === "failed") {
    return "Managed Notion schema 확인 중 오류가 발생했습니다.";
  }
  return "Managed Notion schema 확인 결과가 아직 없습니다.";
}

function formatSchemaDiffMessage(diff: NotionSchemaDiff): string {
  return [
    `누락 ${diff.missing.length}`,
    `이름변경 ${diff.renames.length}`,
    `타입불일치 ${diff.wrongType.length}`,
    `옵션누락 ${diff.missingOptions.length}`,
    `관리외 ${diff.extra.length}`,
  ].join(" / ");
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : { value };
}

function formatSchemaApplyMessage(
  operations: NonNullable<NotionDashboardSchemaActionResult["operations"]>,
): string {
  return [
    `생성 ${operations.create}`,
    `이름변경 ${operations.rename}`,
    `타입변경 ${operations.updateType}`,
    `옵션보강 ${operations.updateOptions}`,
    `삭제 ${operations.delete}`,
  ].join(" / ");
}

function schemaDiffUserAction(diff: NotionSchemaDiff): string | null {
  if (
    diff.missing.length === 0 &&
    diff.renames.length === 0 &&
    diff.wrongType.length === 0 &&
    diff.missingOptions.length === 0
  ) {
    return diff.extra.length > 0
      ? "관리 외 속성은 삭제하지 않습니다. 필요 없다면 Notion에서 직접 삭제해 주세요."
      : null;
  }
  return "스키마 맞추기를 누르면 누락 속성과 이름 변경, select 옵션 보강을 자동 적용합니다.";
}

function countRosterRoles(
  entries: readonly { normalizedRoles: readonly string[] }[],
): number {
  const roles = new Set<string>();
  for (const entry of entries) {
    for (const role of entry.normalizedRoles) {
      if (role) {
        roles.add(role);
      }
    }
  }
  return roles.size;
}

function buildNotionDashboardDisplay(input: {
  status: NotionDashboardSnapshot["status"];
  message: string;
  userAction: string | null;
  uploadMode: string;
  targetUrl: string | null;
  managedRegistry?: ManagedNotionRegistrySnapshot;
}): HumanStatusDisplay {
  return buildHumanStatusDisplay(undefined, {
    ...notionDashboardDisplayKeys(input.status),
    status: input.status,
    message: input.message,
    userAction: input.userAction,
    details: [
      { label: "uploadMode", value: input.uploadMode },
      { label: "targetUrl", value: input.targetUrl },
      { label: "managedRegistry", value: input.managedRegistry },
    ],
  });
}

function buildNotionUploadActionDisplay(input: {
  status: string;
  message: string;
  userAction: string | null;
  technicalDetail: string | null;
  details: readonly { label: string; value: unknown }[];
}): HumanStatusDisplay {
  return buildHumanStatusDisplay(undefined, {
    ...notionUploadDisplayKeys(input.status),
    status: input.status,
    message: input.message,
    userAction: input.userAction,
    technicalDetail: input.technicalDetail,
    details: input.details,
  });
}

function notionDashboardDisplayKeys(
  status: NotionDashboardSnapshot["status"],
): Pick<
  HumanStatusDisplayInput,
  "titleKey" | "descriptionKey" | "nextActionKey"
> {
  if (status === "disabled") {
    return {
      titleKey: "statusDisplay.notion.disabled.title",
      descriptionKey: "statusDisplay.notion.disabled.description",
      nextActionKey: "statusDisplay.notion.disabled.nextAction",
    };
  }
  if (status === "not_configured") {
    return {
      titleKey: "statusDisplay.notion.notConfigured.title",
      descriptionKey: "statusDisplay.notion.notConfigured.description",
      nextActionKey: "statusDisplay.notion.notConfigured.nextAction",
    };
  }
  if (status === "blocked") {
    return {
      titleKey: "statusDisplay.notion.registryPartial.title",
      descriptionKey: "statusDisplay.notion.registryPartial.description",
      nextActionKey: "statusDisplay.notion.registryPartial.nextAction",
    };
  }
  return {
    titleKey: "statusDisplay.notion.ready.title",
    descriptionKey: "statusDisplay.notion.ready.description",
  };
}

function notionUploadDisplayKeys(
  status: string,
): Pick<
  HumanStatusDisplayInput,
  "titleKey" | "descriptionKey" | "nextActionKey"
> {
  if (status === "done") {
    return {
      titleKey: "statusDisplay.notion.done.title",
      descriptionKey: "statusDisplay.notion.done.description",
    };
  }
  if (status === "retry_wait") {
    return {
      titleKey: "statusDisplay.notion.retryWait.title",
      descriptionKey: "statusDisplay.notion.retryWait.description",
      nextActionKey: "statusDisplay.notion.retryWait.nextAction",
    };
  }
  if (status === "not_claimed") {
    return {
      titleKey: "statusDisplay.notion.notClaimed.title",
      descriptionKey: "statusDisplay.notion.notClaimed.description",
    };
  }
  if (status === "blocked") {
    return {
      titleKey: "statusDisplay.notion.blocked.title",
      descriptionKey: "statusDisplay.notion.blocked.description",
      nextActionKey: "statusDisplay.notion.blocked.nextAction",
    };
  }
  if (status === "not_configured" || status === "disabled") {
    return notionDashboardDisplayKeys(status);
  }
  return {
    titleKey: "statusDisplay.notion.failed.title",
    descriptionKey: "statusDisplay.notion.failed.description",
    nextActionKey: "statusDisplay.notion.failed.nextAction",
  };
}
