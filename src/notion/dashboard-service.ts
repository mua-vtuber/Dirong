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
  NOTION_DATABASE_ROLES,
  notionSchemaPresetForLocale,
  type NotionDatabaseRole,
  type NotionSchemaPreset,
} from "./schema-presets.js";
import {
  DEFAULT_NOTION_WORKSPACE_SETTINGS_ID,
  NotionRegistryStore,
} from "./registry-store.js";
import { NotionWriteStore } from "./write-store.js";
import { SqlRunner } from "../storage/sql-runner.js";
import type { DirongDatabase } from "../storage/sqlite.js";
import { resolveAppLocale, type AppLocaleResolver } from "../i18n/app-locale.js";
import { formatLocaleText, t } from "../i18n/catalog.js";
import type { DirongLocale } from "../settings/local-settings-store.js";

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
      projectId?: string | null;
      getProjectId?: () => string | null | undefined;
      retention?: NotionUploadRetentionHandler;
      localeResolver?: AppLocaleResolver;
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

  private locale(locale?: DirongLocale): DirongLocale {
    return resolveAppLocale({ locale, getLocale: this.input.localeResolver });
  }

  clearCachedManagedSchemaCheck(): void {
    this.lastManagedSchemaCheck = null;
  }

  private recordManagedSchemaRepairItem(input: {
    role: NotionDatabaseRole;
    status: "open" | "repaired";
    severity: "info" | "warn" | "error";
    details: unknown;
  }): void {
    const nowIso = new Date().toISOString();
    const projectId = this.resolveProjectId();
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
      `notion_managed_schema:${formatProjectScope(projectId)}:${input.role}`,
      "notion_managed_schema",
      input.status,
      input.severity,
      JSON.stringify(redactForJson({
        projectId: projectId ?? null,
        role: input.role,
        ...asRecord(input.details),
      })),
      nowIso,
      nowIso,
    );
  }

  getSnapshot(locale?: DirongLocale): NotionDashboardSnapshot {
    const resolvedLocale = this.locale(locale);
    const settings = this.getSettings();
    const projectId = this.resolveProjectId();
    const managedRegistry = readManagedNotionRegistrySnapshot(this.registryStore, {
      projectId,
      remoteCheck: this.lastManagedSchemaCheck,
    });
    const memberRoster = this.getMemberRosterSnapshot(projectId);
    const configured = Boolean(
      settings.apiKey &&
        (settings.targetUrl ||
          hasCompleteManagedNotionUploadRegistry(this.registryStore, {
            projectId,
          })),
    );
    const customProperties = this.getCustomPropertiesSnapshot(
      projectId,
      resolvedLocale,
    );
    if (!settings.enabled) {
      const display = buildNotionDashboardDisplay(resolvedLocale, {
        status: "disabled",
        uploadMode: settings.uploadMode,
        targetUrl: settings.targetUrl,
      });
      return {
        enabled: false,
        configured,
        status: "disabled",
        uploadMode: settings.uploadMode,
        targetUrl: settings.targetUrl,
        message: display.description,
        userAction: display.nextAction,
        display,
        managedRegistry,
        memberRoster,
        settings: snapshotNotionRuntimeSettings(settings),
        customProperties,
      };
    }
    if (managedRegistry.status === "partial") {
      const display = buildNotionDashboardDisplay(resolvedLocale, {
        status: "blocked",
        uploadMode: settings.uploadMode,
        targetUrl: settings.targetUrl,
        managedRegistry,
      });
      return {
        enabled: true,
        configured: false,
        status: "blocked",
        uploadMode: settings.uploadMode,
        targetUrl: settings.targetUrl,
        message: display.description,
        userAction: display.nextAction,
        display,
        managedRegistry,
        memberRoster,
        settings: snapshotNotionRuntimeSettings(settings),
        customProperties,
      };
    }
    if (!configured) {
      const display = buildNotionDashboardDisplay(resolvedLocale, {
        status: "not_configured",
        uploadMode: settings.uploadMode,
        targetUrl: settings.targetUrl,
        managedRegistry,
      });
      return {
        enabled: true,
        configured: false,
        status: "not_configured",
        uploadMode: settings.uploadMode,
        targetUrl: settings.targetUrl,
        message: display.description,
        userAction: display.nextAction,
        display,
        managedRegistry,
        memberRoster,
        settings: snapshotNotionRuntimeSettings(settings),
        customProperties,
      };
    }
    const display = buildNotionDashboardDisplay(resolvedLocale, {
      status: "ready",
      uploadMode: settings.uploadMode,
      targetUrl: settings.targetUrl,
      managedRegistry,
    });
    return {
      enabled: true,
      configured: true,
      status: "ready",
      uploadMode: settings.uploadMode,
      targetUrl: settings.targetUrl,
      message: display.description,
      userAction: display.nextAction,
      display,
      managedRegistry,
      memberRoster,
      settings: snapshotNotionRuntimeSettings(settings),
      customProperties,
    };
  }

  async checkManagedSchema(): Promise<ManagedNotionSchemaStatusSnapshot> {
    const locale = this.locale();
    const settings = this.getSettings();
    if (!settings.apiKey) {
      throw new Error(t(locale, "notionDashboardService.managedSchema.checkRequiresToken"));
    }
    const client = this.createClient(settings, locale);
    if (!client) {
      throw new Error(t(locale, "notionDashboardService.managedSchema.clientMissing"));
    }
    const service = new ManagedNotionSchemaStatusService({
      client,
      registryStore: this.registryStore,
      projectId: this.resolveProjectId(),
      locale,
    });
    this.lastManagedSchemaCheck = await service.checkAll();
    return this.lastManagedSchemaCheck;
  }

  async checkManagedSchemaWithPlans(): Promise<NotionDashboardManagedSchemaCheckResult> {
    const locale = this.locale();
    const snapshot = await this.checkManagedSchema();
    const projectId = this.resolveProjectId();
    const mappings = this.registryStore.listPropertyMappings(undefined, projectId);
    const managedDatabases = this.registryStore.listManagedDatabases(projectId);
    const plans = Object.fromEntries(
      snapshot.databases.map((database) => [
        database.role,
        database.remote.diff
          ? buildManagedSchemaRepairPlan({
              role: database.role,
              diff: database.remote.diff,
              mappings,
              managedDatabases,
              preset: this.managedSchemaPresetForRole(database.role, projectId),
              locale,
            })
          : emptyManagedSchemaRepairPlan(database.role),
      ]),
    ) as Record<NotionDatabaseRole, ManagedSchemaRepairPlan>;
    return {
      ok: snapshot.status !== "failed",
      status: snapshot.status,
      message: managedSchemaCheckMessage(snapshot.status, locale),
      userAction:
        snapshot.status === "healthy"
          ? null
          : t(locale, "notionDashboardService.managedSchema.repairPlanAction"),
      snapshot,
      plans,
    };
  }

  async repairManagedSchema(
    input: NotionDashboardManagedSchemaRepairInput,
  ): Promise<NotionDashboardManagedSchemaRepairResult> {
    const locale = this.locale();
    if (!input.confirm) {
      throw new Error(t(locale, "notionDashboardService.managedSchema.repairConfirmRequired"));
    }
    const settings = this.getSettings();
    if (!settings.apiKey) {
      throw new Error(t(locale, "notionDashboardService.managedSchema.repairRequiresToken"));
    }
    const client = this.createClient(settings, locale);
    if (!client) {
      throw new Error(t(locale, "notionDashboardService.managedSchema.clientMissing"));
    }

    try {
      const result = await applyManagedSchemaRepair({
        client,
        registryStore: this.registryStore,
        role: input.role,
        expectedPlanHash: input.expectedPlanHash,
        projectId: this.resolveProjectId(),
        operationIds: input.operations,
        preset: this.managedSchemaPresetForRole(input.role, this.resolveProjectId()),
        locale,
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
        projectId: this.resolveProjectId(),
        locale,
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
    locale?: DirongLocale,
  ): Promise<NotionDashboardActionResult> {
    const resolvedLocale = this.locale(locale);
    const selector = selectorFromAction(action);
    if (!selector) {
      const display = buildNotionUploadActionDisplay(resolvedLocale, {
        status: "draft_not_found",
        message: "missing_selector",
        userAction: "provide_session_or_draft",
        technicalDetail: null,
        details: [
          { label: "sessionId", value: action.sessionId },
          { label: "draftId", value: action.draftId },
        ],
      });
      return {
        ok: false,
        status: "draft_not_found",
        message: display.description,
        userAction: display.nextAction,
        display,
        pageUrl: null,
      };
    }

    const settings = this.getSettings();
    const client = this.createClient(settings, resolvedLocale);
    const projectId = this.resolveProjectId();
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
      projectId,
      memberRosterStore: this.memberRosterStore,
      customPropertyRules: this.propertyRuleStore.listEnabledRules(
        "meeting",
        projectId,
      ),
      locale: resolvedLocale,
    });
    try {
      await applyRetentionAfterSuccessfulUpload(this.input.retention, result);
    } catch (error) {
      const display = buildNotionUploadActionDisplay(resolvedLocale, {
        status: "failed",
        message: "retention_policy_failed",
        userAction: "check_local_storage_paths",
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
      });
      return {
        ok: false,
        status: "failed",
        message: display.description,
        userAction: display.nextAction,
        display,
        technicalDetail: summarizeSafeError(error),
        pageUrl: result.pageUrl,
      };
    }

    const display = buildNotionUploadActionDisplay(resolvedLocale, {
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
    });
    return {
      ok: ["done", "retry_wait", "not_claimed"].includes(result.status),
      status: result.status,
      message: display.description,
      userAction: display.nextAction,
      display,
      technicalDetail: result.technicalDetail,
      pageUrl: result.pageUrl,
    };
  }

  async syncMemberRoster(): Promise<NotionMemberRosterSyncResult> {
    const locale = this.locale();
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

    const client = this.createClient(settings, locale);
    const projectId = this.resolveProjectId();
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
        projectId,
        locale,
      });
    } catch (error) {
      const memberDatabase = this.registryStore.getManagedDatabase(
        "member",
        projectId,
      );
      if (memberDatabase) {
        this.memberRosterStore.recordSyncSnapshot({
          projectId,
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
    const locale = this.locale();
    const settings = this.getSettings();
    if (!settings.enabled || !settings.apiKey) {
      return this.customPropertyActionResult({
        ok: false,
        status: "not_configured",
        message: t(locale, "notionDashboardService.customProperties.schemaRequiresSetup"),
        userAction: t(locale, "notionDashboardService.customProperties.checkTokenAndManagedDb"),
      }, locale);
    }

    const client = this.createClient(settings, locale);
    if (!client) {
      return this.customPropertyActionResult({
        ok: false,
        status: "not_configured",
        message: t(locale, "notionDashboardService.customProperties.clientMissing"),
        userAction: t(locale, "notionDashboardService.customProperties.checkTokenAndManagedDb"),
      }, locale);
    }
    const target = await this.loadCustomPropertyDataSource({
      client,
      settings,
      role: input.role,
      locale,
    });
    if (!target.ok) {
      return this.customPropertyActionResult({
        ok: false,
        status: "not_configured",
        message: target.message,
        userAction: target.userAction,
      }, locale);
    }

    try {
      const syncResult = this.propertyRuleStore.syncDataSourceProperties({
        projectId: this.resolveProjectId(),
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
        message: formatLocaleText(
          locale,
          "notionDashboardService.customProperties.syncDone",
          {
            discovered: syncResult.discovered,
            custom: syncResult.custom,
          },
        ),
        userAction: null,
      }, locale);
    } catch (error) {
      return this.customPropertyActionResult({
        ok: false,
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
        userAction:
          error instanceof NotionApiError
            ? error.userAction
            : t(locale, "notionDashboardService.customProperties.connectionAction"),
      }, locale);
    }
  }

  saveCustomPropertyRules(
    input: {
      role: NotionDatabaseRole;
      rules: readonly NotionCustomPropertyRuleInput[];
    },
  ): NotionDashboardCustomPropertyActionResult {
    const locale = this.locale();
    const result = this.propertyRuleStore.saveRules({
      projectId: this.resolveProjectId(),
      databaseRole: input.role,
      rules: input.rules,
      requiredPropertyNames: this.requiredCustomPropertyNamesForRole(
        input.role,
        this.getSettings(),
      ),
      nowIso: new Date().toISOString(),
      locale,
    });
    return this.customPropertyActionResult({
      ok: true,
      status: "done",
      message: formatLocaleText(
        locale,
        "notionDashboardService.customProperties.rulesSaved",
        {
          saved: result.saved,
          deleted: result.deleted,
        },
      ),
      userAction:
        result.ignored > 0
          ? formatLocaleText(
              locale,
              "notionDashboardService.customProperties.rulesIgnored",
              { ignored: result.ignored },
            )
          : null,
      warnings: result.warnings,
    }, locale);
  }

  async inspectSchema(): Promise<NotionDashboardSchemaActionResult> {
    const locale = this.locale();
    const context = await this.loadSchemaContext(locale);
    if (!context.ok) {
      return context.result;
    }
    return {
      ok: true,
      status: "done",
      message: formatSchemaDiffMessage(context.diff, locale),
      userAction: schemaDiffUserAction(context.diff, locale),
      warnings: context.diff.warnings,
      diff: context.diff,
      operations: null,
    };
  }

  async applySchema(
    options: NotionSchemaApplyOptions,
  ): Promise<NotionDashboardSchemaActionResult> {
    const locale = this.locale();
    const context = await this.loadSchemaContext(locale);
    if (!context.ok) {
      return context.result;
    }

    const plan = buildNotionSchemaUpdatePlan(context.diff, options, locale);
    if (!plan.body) {
      return {
        ok: plan.blocked.length === 0,
        status: plan.blocked.length > 0 ? "blocked" : "done",
        message:
          plan.blocked.length > 0
            ? t(locale, "notionDashboardService.schema.blockedApply")
            : t(locale, "notionDashboardService.schema.noChanges"),
        userAction:
          plan.blocked.length > 0
            ? plan.blocked.join(" ")
            : schemaDiffUserAction(context.diff, locale),
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
          projectId: this.resolveProjectId(),
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
                this.propertyRuleStore.listRules("meeting", this.resolveProjectId()),
                locale,
              )
            ).rules,
            locale,
          })
        : context.diff;
      return {
        ok: plan.blocked.length === 0,
        status: plan.blocked.length > 0 ? "partial" : "done",
        message: formatSchemaApplyMessage(plan.operations, locale),
        userAction:
          plan.blocked.length > 0
            ? plan.blocked.join(" ")
            : schemaDiffUserAction(after, locale),
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
            : t(locale, "notionDashboardService.schema.connectionAction"),
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
  }, locale = this.locale()): NotionDashboardCustomPropertyActionResult {
    return {
      ...input,
      warnings: input.warnings ?? [],
      customProperties: this.getCustomPropertiesSnapshot(
        this.resolveProjectId(),
        locale,
      ),
    };
  }

  private getCustomPropertiesSnapshot(
    projectId: string | undefined,
    locale = this.locale(),
  ): NotionCustomPropertiesDashboardSnapshot {
    const roles = Object.fromEntries(
      NOTION_DATABASE_ROLES.map((role) => [
        role,
        this.getCustomPropertiesRoleSnapshot(role, projectId, locale),
      ]),
    ) as Record<NotionDatabaseRole, NotionCustomPropertiesRoleSnapshot>;
    return {
      ...roles.meeting,
      roles,
    };
  }

  private getMemberRosterSnapshot(
    projectId: string | undefined,
  ): NotionMemberRosterDashboardSnapshot {
    const memberDatabase = this.registryStore.getManagedDatabase(
      "member",
      projectId,
    );
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
      projectId,
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
      projectId,
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
    projectId: string | undefined,
    locale: DirongLocale,
  ): NotionCustomPropertiesRoleSnapshot {
    const rules = this.propertyRuleStore.listRules(role, projectId);
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
        projectId,
      ),
      rules,
      enabledCount,
      promptPreview,
      message:
        rules.length === 0
          ? t(locale, "notionDashboardService.customProperties.emptyRules")
          : formatLocaleText(
              locale,
              "notionDashboardService.customProperties.enabledRules",
              {
                rules: rules.length,
                enabled: enabledCount,
              },
            ),
      userAction: null,
    };
  }

  private requiredCustomPropertyNamesForRole(
    role: NotionDatabaseRole,
    settings: NotionRuntimeSettings,
    projectId = this.resolveProjectId(),
  ): string[] {
    if (
      role === "meeting" &&
      !this.registryStore.getManagedDatabase("meeting", projectId)
    ) {
      return Object.values(settings.propertyNames);
    }
    const names = new Set<string>();
    for (const mapping of this.registryStore.listPropertyMappings(role, projectId)) {
      names.add(mapping.propertyName);
    }
    for (const property of this.managedSchemaPresetForRole(role, projectId)
      .databases[role].properties) {
      names.add(property.name);
    }
    return [...names];
  }

  private managedSchemaPresetForRole(
    role: NotionDatabaseRole,
    projectId = this.resolveProjectId(),
  ): NotionSchemaPreset {
    const managedDatabase = this.registryStore.getManagedDatabase(role, projectId);
    const workspace = projectId === undefined
      ? this.registryStore.getWorkspaceSettings()
      : this.registryStore.getWorkspaceSettings(
          DEFAULT_NOTION_WORKSPACE_SETTINGS_ID,
          projectId,
        );
    return notionSchemaPresetForLocale(managedDatabase?.locale ?? workspace?.locale);
  }

  private async loadCustomPropertyDataSource(input: {
    client: NotionClient;
    settings: NotionRuntimeSettings;
    role: NotionDatabaseRole;
    locale: DirongLocale;
  }): Promise<
    | { ok: true; dataSource: Record<string, unknown> }
    | { ok: false; message: string; userAction: string }
  > {
    const managedDatabase = this.registryStore.getManagedDatabase(
      input.role,
      this.resolveProjectId(),
    );
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
        message: t(input.locale, "notionDashboardService.customProperties.missingManagedDb"),
        userAction: t(
          input.locale,
          "notionDashboardService.customProperties.createManagedDbAction",
        ),
      };
    }
    if (!input.settings.targetUrl) {
      return {
        ok: false,
        message: "Notion target URL is missing.",
        userAction: t(
          input.locale,
          "notionDashboardService.customProperties.checkTargetOrManagedDb",
        ),
      };
    }
    const parsedTarget = parseNotionTargetUrl(input.settings.targetUrl);
    if (parsedTarget.kind === "invalid") {
      return {
        ok: false,
        message: "Notion target URL is invalid.",
        userAction: t(
          input.locale,
          "notionDashboardService.customProperties.invalidTargetAction",
        ),
      };
    }
    return {
      ok: true,
      dataSource: await resolveDataSource(input.client, parsedTarget),
    };
  }

  private async loadSchemaContext(locale = this.locale()): Promise<
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
          message: t(locale, "notionDashboardService.schema.setupRequired"),
          userAction: t(locale, "notionDashboardService.schema.setupAction"),
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
          userAction: t(locale, "notionDashboardService.schema.invalidTargetAction"),
        }),
      };
    }

    const client = this.createClient(settings, locale);
    if (!client) {
      return {
        ok: false,
        result: schemaActionErrorResult({
          status: "not_configured",
          message: t(locale, "notionDashboardService.schema.clientMissing"),
          userAction: t(locale, "notionDashboardService.schema.tokenAction"),
        }),
      };
    }

    try {
      const target = await resolveDataSourceTarget(client, parsedTarget);
      const relationResolution = await resolveRelationRuleTargets(
        client,
        this.propertyRuleStore.listRules("meeting", this.resolveProjectId()),
        locale,
      );
      const diff = buildNotionSchemaDiff({
        properties: readDataSourceProperties(target.dataSource),
        propertyNames: settings.propertyNames,
        customRules: relationResolution.rules,
        locale,
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
              : t(locale, "notionDashboardService.schema.connectionAction"),
        }),
      };
    }
  }

  private createClient(
    settings: NotionRuntimeSettings,
    locale = this.locale(),
  ): NotionClient | null {
    if (this.input.notionClientFactory) {
      return this.input.notionClientFactory(settings);
    }
    return settings.apiKey
      ? createNotionClient({
          apiKey: settings.apiKey,
          apiVersion: settings.apiVersion,
          baseUrl: settings.baseUrl,
          requestTimeoutMs: settings.requestTimeoutMs,
          locale,
        })
      : null;
  }

  private resolveProjectId(): string | undefined {
    return this.input.getProjectId?.() ?? this.input.projectId ?? undefined;
  }
}

async function resolveRelationRuleTargets(
  client: NotionClient,
  rules: readonly NotionCustomPropertyRule[],
  locale: DirongLocale,
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
        warnings.push(formatLocaleText(
          locale,
          "notionDashboardService.relationRules.pageUrlInvalid",
          { property: rule.propertyName },
        ));
      }
    }
    if (!rule.relationTargetUrl) {
      resolved.push(nextRule);
      continue;
    }
    const parsed = parseNotionTargetUrl(rule.relationTargetUrl);
    if (parsed.kind === "invalid") {
      warnings.push(formatLocaleText(
        locale,
        "notionDashboardService.relationRules.targetUrlInvalid",
        { property: rule.propertyName },
      ));
      resolved.push(nextRule);
      continue;
    }
    try {
      const target = await resolveDataSourceTarget(client, parsed);
      resolved.push({ ...nextRule, relationDataSourceId: target.id });
    } catch (error) {
      warnings.push(formatLocaleText(
        locale,
        "notionDashboardService.relationRules.targetDbAccessFailed",
        {
          property: rule.propertyName,
          error: error instanceof Error ? error.message : String(error),
        },
      ));
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

function managedSchemaCheckMessage(status: string, locale: DirongLocale): string {
  if (status === "healthy") {
    return t(locale, "notionDashboardService.managedSchema.status.healthy");
  }
  if (status === "needs_repair") {
    return t(locale, "notionDashboardService.managedSchema.status.needsRepair");
  }
  if (status === "manual_required") {
    return t(locale, "notionDashboardService.managedSchema.status.manualRequired");
  }
  if (status === "failed") {
    return t(locale, "notionDashboardService.managedSchema.status.failed");
  }
  return t(locale, "notionDashboardService.managedSchema.status.unchecked");
}

function formatSchemaDiffMessage(
  diff: NotionSchemaDiff,
  locale: DirongLocale,
): string {
  return formatLocaleText(locale, "notionDashboardService.schema.diffMessage", {
    missing: diff.missing.length,
    renames: diff.renames.length,
    wrongType: diff.wrongType.length,
    missingOptions: diff.missingOptions.length,
    extra: diff.extra.length,
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : { value };
}

function formatSchemaApplyMessage(
  operations: NonNullable<NotionDashboardSchemaActionResult["operations"]>,
  locale: DirongLocale,
): string {
  return formatLocaleText(locale, "notionDashboardService.schema.applyMessage", {
    create: operations.create,
    rename: operations.rename,
    updateType: operations.updateType,
    updateOptions: operations.updateOptions,
    delete: operations.delete,
  });
}

function schemaDiffUserAction(
  diff: NotionSchemaDiff,
  locale: DirongLocale,
): string | null {
  if (
    diff.missing.length === 0 &&
    diff.renames.length === 0 &&
    diff.wrongType.length === 0 &&
    diff.missingOptions.length === 0
  ) {
    return diff.extra.length > 0
      ? t(locale, "notionDashboardService.schema.extraPreservedAction")
      : null;
  }
  return t(locale, "notionDashboardService.schema.applyAction");
}

function formatProjectScope(projectId: string | undefined): string {
  return projectId ?? "legacy";
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

function buildNotionDashboardDisplay(locale: DirongLocale, input: {
  status: NotionDashboardSnapshot["status"];
  uploadMode: string;
  targetUrl: string | null;
  managedRegistry?: ManagedNotionRegistrySnapshot;
}): HumanStatusDisplay {
  return buildHumanStatusDisplay(locale, {
    ...notionDashboardDisplayKeys(input.status),
    status: input.status,
    details: [
      { label: "uploadMode", value: input.uploadMode },
      { label: "targetUrl", value: input.targetUrl },
      { label: "managedRegistry", value: input.managedRegistry },
    ],
  });
}

function buildNotionUploadActionDisplay(locale: DirongLocale, input: {
  status: string;
  message: string;
  userAction: string | null;
  technicalDetail: string | null;
  details: readonly { label: string; value: unknown }[];
}): HumanStatusDisplay {
  return buildHumanStatusDisplay(locale, {
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
  if (status === "draft_not_found") {
    return {
      titleKey: "statusDisplay.notion.draftNotFound.title",
      descriptionKey: "statusDisplay.notion.draftNotFound.description",
      nextActionKey: "statusDisplay.notion.draftNotFound.nextAction",
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
