import { createServer, type Server } from "node:http";
import { DirongError } from "../errors.js";
import type { AiCleanupAutomationSnapshot } from "../ai/cleanup/automation-service.js";
import type { AiProviderRuntimeReadinessSnapshot } from "../ai/cleanup/provider-lifecycle.js";
import type { Phase1Config } from "../config.js";
import type { NotionAutomationSnapshot } from "../notion/automation-service.js";
import type {
  NotionDashboardActionResult,
  NotionDashboardCustomPropertyActionResult,
  NotionDashboardManagedSchemaCheckResult,
  NotionDashboardManagedSchemaRepairInput,
  NotionDashboardManagedSchemaRepairResult,
  NotionDashboardSchemaActionResult,
  NotionDashboardSnapshot,
} from "../notion/dashboard-service.js";
import type { NotionMemberRosterSyncResult } from "../notion/member-roster-sync.js";
import type { NotionCustomPropertyRuleInput } from "../notion/property-rules.js";
import type { NotionDatabaseRole } from "../notion/schema-presets.js";
import type { NotionSchemaApplyOptions } from "../notion/schema-manager.js";
import type { ActiveProjectSwitchResult } from "../projects/active-project-service.js";
import type { DirongProjectRow } from "../projects/project-types.js";
import type { AloneFinalizeSnapshot } from "../recording/alone-finalize-service.js";
import type { RecordingProducer } from "../recording/recording-producer.js";
import type {
  DirongDashboardTheme,
  DirongLocale,
} from "../settings/local-settings-store.js";
import type { ProductSetupStatusSnapshot } from "../settings/product-settings.js";
import type {
  SettingsResetRequest,
  SettingsResetResult,
} from "../settings/reset-service.js";
import type { SetupWizardActionResult, SetupWizardStateSnapshot } from "../setup/wizard-service.js";
import type { SttAutomationSnapshot } from "../stt/automation-service.js";
import { routeDashboardRequest } from "./router.js";
import { createDashboardToken } from "./security.js";
import type { DashboardStore } from "./storage-port.js";

export {
  appendAiReadinessToDashboardState,
  appendDashboardRuntimeSnapshots,
} from "./state.js";

export type DashboardAiReadinessSource = {
  getSnapshot(locale?: DirongLocale): AiProviderRuntimeReadinessSnapshot;
};

export type DashboardAiCleanupAutomationSource = {
  getSnapshot(locale?: DirongLocale): AiCleanupAutomationSnapshot;
};

export type DashboardAloneFinalizeSource = {
  getSnapshot(locale?: DirongLocale): AloneFinalizeSnapshot;
};

export type DashboardSttAutomationSource = {
  getSnapshot(locale?: DirongLocale): SttAutomationSnapshot;
};

export type DashboardNotionSource = {
  getSnapshot(locale?: DirongLocale): NotionDashboardSnapshot;
  runManualUpload(input: {
    sessionId: string | null;
    draftId: string | null;
    force: boolean;
  }, locale?: DirongLocale): Promise<NotionDashboardActionResult>;
  syncCustomProperties(input: {
    role: NotionDatabaseRole;
  }): Promise<NotionDashboardCustomPropertyActionResult>;
  syncMemberRoster(): Promise<NotionMemberRosterSyncResult>;
  saveCustomPropertyRules(input: {
    role: NotionDatabaseRole;
    rules: readonly NotionCustomPropertyRuleInput[];
  }): NotionDashboardCustomPropertyActionResult;
  inspectSchema(): Promise<NotionDashboardSchemaActionResult>;
  applySchema(input: NotionSchemaApplyOptions): Promise<NotionDashboardSchemaActionResult>;
  checkManagedSchemaWithPlans(): Promise<NotionDashboardManagedSchemaCheckResult>;
  repairManagedSchema(
    input: NotionDashboardManagedSchemaRepairInput,
  ): Promise<NotionDashboardManagedSchemaRepairResult>;
};

export type DashboardNotionAutomationSource = {
  getSnapshot(locale?: DirongLocale): NotionAutomationSnapshot;
};

export type DashboardSetupStatusSource = {
  getSnapshot(): ProductSetupStatusSnapshot;
  getLocale?(): DirongLocale;
  setLocale?(locale: DirongLocale): ProductSetupStatusSnapshot;
  getTheme?(): DirongDashboardTheme;
  setTheme?(theme: DirongDashboardTheme): ProductSetupStatusSnapshot;
};

export type DashboardSetupWizardSource = {
  getState(): SetupWizardStateSnapshot;
  saveDiscordApplicationId(body: unknown): SetupWizardActionResult;
  saveDiscordBotToken(body: unknown): SetupWizardActionResult;
  testDiscordConnection(): Promise<SetupWizardActionResult>;
  listDiscordGuilds(): Promise<SetupWizardActionResult>;
  saveDiscordGuildAllowlist(body: unknown): Promise<SetupWizardActionResult>;
  saveSttSettings(body: unknown): SetupWizardActionResult;
  saveClaudeSettings(body: unknown): SetupWizardActionResult;
  testClaudeConnection(): Promise<SetupWizardActionResult>;
  saveNotionToken(body: unknown): SetupWizardActionResult;
  saveNotionParentPageUrl(body: unknown): SetupWizardActionResult;
  verifyNotionParentPage(): Promise<SetupWizardActionResult>;
  createManagedDatabases(): Promise<SetupWizardActionResult>;
};

export type DashboardProjectsCreateDraftInput = {
  name?: string;
  reuseEmptyDraft?: boolean;
  activate?: boolean;
};

export type DashboardProjectsCreateDraftResult = {
  project: DirongProjectRow;
  reused: boolean;
  switchResult?: ActiveProjectSwitchResult;
};

export type DashboardProjectsSource = {
  listProjects(): DirongProjectRow[];
  getActiveProject(): DirongProjectRow | null;
  createDraftProject(
    input?: DashboardProjectsCreateDraftInput,
  ): Promise<DashboardProjectsCreateDraftResult> | DashboardProjectsCreateDraftResult;
  switchActiveProject(projectId: string): Promise<ActiveProjectSwitchResult>;
};

export type DashboardSettingsResetSource = {
  reset(input: SettingsResetRequest): Promise<SettingsResetResult>;
};

export type DashboardRuntimeSources = {
  aiReadiness?: DashboardAiReadinessSource;
  aiCleanupAutomation?: DashboardAiCleanupAutomationSource;
  aloneFinalize?: DashboardAloneFinalizeSource;
  notion?: DashboardNotionSource;
  notionAutomation?: DashboardNotionAutomationSource;
  setupStatus?: DashboardSetupStatusSource;
  setupWizard?: DashboardSetupWizardSource;
  projects?: DashboardProjectsSource;
  settingsReset?: DashboardSettingsResetSource;
  sttAutomation?: DashboardSttAutomationSource;
};

export class DashboardServer {
  private server: Server | null = null;
  private url: string | null = null;
  private dashboardToken = createDashboardToken();
  private audioTokenSecret = createDashboardToken();

  constructor(
    private readonly config: Phase1Config,
    private readonly store: DashboardStore,
    private readonly producer: RecordingProducer,
    private readonly runtimeSources: DashboardRuntimeSources = {},
  ) {}

  async start(): Promise<string> {
    if (this.server && this.url) {
      return this.url;
    }

    this.dashboardToken = createDashboardToken();
    this.audioTokenSecret = createDashboardToken();
    const server = createServer((request, response) => {
      void routeDashboardRequest({
        request,
        response,
        getUrl: () => this.getUrl(),
        dashboardToken: this.dashboardToken,
        audioTokenSecret: this.audioTokenSecret,
        store: this.store,
        producer: this.producer,
        runtimeSources: this.runtimeSources,
      });
    });
    this.server = server;

    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = (): void => {
          server.off("error", onError);
          resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(this.config.dashboardPort, this.config.dashboardHost);
      });
    } catch (error) {
      this.server = null;
      this.url = null;
      throw normalizeListenError(
        error,
        this.config.dashboardHost,
        this.config.dashboardPort,
      );
    }

    const address = server.address();
    const port =
      address && typeof address === "object"
        ? address.port
        : this.config.dashboardPort;
    this.url = `http://${this.config.dashboardHost}:${port}/`;
    return this.url;
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }
    await new Promise<void>((resolve) => {
      this.server?.close(() => resolve());
    });
    this.server = null;
    this.url = null;
  }

  getUrl(): string {
    return this.url ?? `http://${this.config.dashboardHost}:${this.config.dashboardPort}/`;
  }
}

function normalizeListenError(
  error: unknown,
  host: string,
  port: number,
): unknown {
  if (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EADDRINUSE"
  ) {
    return new DirongError(
      "DASHBOARD_PORT_IN_USE",
      [
        `디롱이 dashboard 포트를 이미 사용 중입니다: ${host}:${port}`,
        "이미 실행 중인 Dirong 앱이 있으면 그 콘솔에서 exit를 입력해 종료해 주세요.",
        "다른 포트를 쓰려면 dashboard 설정에서 포트를 바꾼 뒤 다시 시작해 주세요.",
      ].join("\n"),
    );
  }
  return error;
}
