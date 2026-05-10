import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { DirongError, redactForJson } from "../errors.js";
import { catalogs, listLocaleKeys, t, type LocaleKey } from "../i18n/catalog.js";
import {
  buildHumanStatusDisplay,
  type HumanStatusDisplay,
  type HumanStatusDisplayInput,
} from "../messages/human-status.js";
import type { AiCleanupAutomationSnapshot } from "../ai/cleanup/automation-service.js";
import type { AiProviderRuntimeReadinessSnapshot } from "../ai/cleanup/provider-lifecycle.js";
import type { Phase1Config } from "../config.js";
import type { AloneFinalizeSnapshot } from "../recording/alone-finalize-service.js";
import type { RecordingProducer } from "../recording/recording-producer.js";
import type { SessionStore } from "../storage/session-store.js";
import type { SttAutomationSnapshot } from "../stt/automation-service.js";
import type {
  NotionDashboardActionResult,
  NotionDashboardCustomPropertyActionResult,
  NotionDashboardSchemaActionResult,
  NotionDashboardSnapshot,
} from "../notion/dashboard-service.js";
import type { NotionCustomPropertyRuleInput } from "../notion/property-rules.js";
import type { NotionSchemaApplyOptions } from "../notion/schema-manager.js";
import type { NotionAutomationSnapshot } from "../notion/automation-service.js";
import type { ProductSetupStatusSnapshot } from "../settings/product-settings.js";
import type {
  SetupWizardActionResult,
  SetupWizardStateSnapshot,
} from "../setup/wizard-service.js";
import {
  DEFAULT_DIRONG_DASHBOARD_THEME,
  DEFAULT_DIRONG_LOCALE,
  isDirongDashboardTheme,
  isDirongLocale,
  type DirongDashboardTheme,
  type DirongLocale,
} from "../settings/local-settings-store.js";

export type DashboardAiReadinessSource = {
  getSnapshot(): AiProviderRuntimeReadinessSnapshot;
};

export type DashboardAiCleanupAutomationSource = {
  getSnapshot(): AiCleanupAutomationSnapshot;
};

export type DashboardAloneFinalizeSource = {
  getSnapshot(): AloneFinalizeSnapshot;
};

export type DashboardSttAutomationSource = {
  getSnapshot(): SttAutomationSnapshot;
};

export type DashboardNotionSource = {
  getSnapshot(): NotionDashboardSnapshot;
  runManualUpload(input: {
    sessionId: string | null;
    draftId: string | null;
    force: boolean;
  }): Promise<NotionDashboardActionResult>;
  syncCustomProperties(): Promise<NotionDashboardCustomPropertyActionResult>;
  saveCustomPropertyRules(
    rules: readonly NotionCustomPropertyRuleInput[],
  ): NotionDashboardCustomPropertyActionResult;
  inspectSchema(): Promise<NotionDashboardSchemaActionResult>;
  applySchema(input: NotionSchemaApplyOptions): Promise<NotionDashboardSchemaActionResult>;
};

export type DashboardNotionAutomationSource = {
  getSnapshot(): NotionAutomationSnapshot;
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

export type DashboardRuntimeSources = {
  aiReadiness?: DashboardAiReadinessSource;
  aiCleanupAutomation?: DashboardAiCleanupAutomationSource;
  aloneFinalize?: DashboardAloneFinalizeSource;
  notion?: DashboardNotionSource;
  notionAutomation?: DashboardNotionAutomationSource;
  setupStatus?: DashboardSetupStatusSource;
  setupWizard?: DashboardSetupWizardSource;
  sttAutomation?: DashboardSttAutomationSource;
};

export class DashboardServer {
  private server: Server | null = null;
  private url: string | null = null;

  constructor(
    private readonly config: Phase1Config,
    private readonly store: SessionStore,
    private readonly producer: RecordingProducer,
    private readonly runtimeSources: DashboardRuntimeSources = {},
  ) {}

  async start(): Promise<string> {
    if (this.server && this.url) {
      return this.url;
    }

    const server = createServer((request, response) => {
      void this.route(request, response);
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

  private async route(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const url = new URL(request.url ?? "/", this.getUrl());
    const languageEndpoint =
      url.pathname === "/api/settings/language" ||
      url.pathname === "/api/setup/language";
    const themeEndpoint = url.pathname === "/api/settings/theme";

    if (request.method === "POST" && languageEndpoint) {
      await this.handleLanguageSave(request, response);
      return;
    }

    if (request.method === "POST" && themeEndpoint) {
      await this.handleThemeSave(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname.startsWith("/api/setup/")) {
      await this.handleSetupWizardPost(request, response, url.pathname);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/notion/send") {
      await this.handleNotionAction(request, response, false);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/notion/retry") {
      await this.handleNotionAction(request, response, true);
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/notion/properties/sync"
    ) {
      await this.handleNotionPropertiesSync(response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/notion/properties") {
      await this.handleNotionPropertiesSave(request, response);
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/notion/schema/inspect"
    ) {
      await this.handleNotionSchemaInspect(response);
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/notion/schema/apply"
    ) {
      await this.handleNotionSchemaApply(request, response);
      return;
    }

    if (request.method !== "GET") {
      sendText(response, 405, "Method Not Allowed");
      return;
    }

    if (url.pathname === "/") {
      sendHtml(response, DASHBOARD_INDEX_HTML);
      return;
    }

    if (url.pathname === "/api/state") {
      const state = this.store.getDashboardState(this.producer.getRuntimeState());
      sendJson(response, appendDashboardRuntimeSnapshots(state, this.runtimeSources));
      return;
    }

    if (url.pathname === "/api/setup/status" || url.pathname === "/api/setup/state") {
      if (this.runtimeSources.setupWizard) {
        sendJson(response, this.runtimeSources.setupWizard.getState());
        return;
      }
      if (!this.runtimeSources.setupStatus) {
        sendJson(response, withMessageKeys(DEFAULT_DIRONG_LOCALE, {
          status: "not_configured",
          messageKey: "error.dashboard.setupStatusSourceMissing.message",
          userActionKey: "error.dashboard.setupStatusSourceMissing.action",
        }));
        return;
      }
      sendJson(response, this.runtimeSources.setupStatus.getSnapshot());
      return;
    }

    if (url.pathname === "/api/setup/discord/guilds") {
      if (!this.runtimeSources.setupWizard) {
        sendJson(response, withMessageKeys(this.getResponseLocale(), {
          ok: false,
          status: "not_configured",
          messageKey: "error.dashboard.setupWizardSourceMissing.message",
          userActionKey: "error.dashboard.setupWizardSourceMissing.action",
          guilds: [],
        }), 500);
        return;
      }
      sendWizardResult(
        response,
        await this.runtimeSources.setupWizard.listDiscordGuilds(),
      );
      return;
    }

    if (languageEndpoint) {
      this.handleLanguageGet(response);
      return;
    }

    if (themeEndpoint) {
      this.handleThemeGet(response);
      return;
    }

    if (url.pathname === "/api/i18n") {
      this.handleI18nGet(response);
      return;
    }

    if (url.pathname.startsWith("/assets/")) {
      this.serveAsset(response, url.pathname);
      return;
    }

    const audioMatch = /^\/audio\/([^/]+)\/(raw|stt)$/.exec(url.pathname);
    if (audioMatch) {
      const chunkId = decodeURIComponent(audioMatch[1] ?? "");
      const kind = (audioMatch[2] ?? "raw") as "raw" | "stt";
      this.serveAudio(request, response, chunkId, kind);
      return;
    }

    sendText(response, 404, "Not Found");
  }

  private getResponseLocale(): DirongLocale {
    return (
      this.runtimeSources.setupStatus?.getLocale?.() ??
      this.runtimeSources.setupStatus?.getSnapshot().locale ??
      DEFAULT_DIRONG_LOCALE
    );
  }

  private handleLanguageGet(response: ServerResponse): void {
    if (!this.runtimeSources.setupStatus) {
      sendJson(response, withMessageKeys(DEFAULT_DIRONG_LOCALE, {
        ok: false,
        status: "not_configured",
        locale: DEFAULT_DIRONG_LOCALE,
        notionSchemaLocale: DEFAULT_DIRONG_LOCALE,
        messageKey: "error.dashboard.settingsSourceMissing.message",
        userActionKey: "error.dashboard.settingsSourceMissing.action",
      }));
      return;
    }

    const snapshot = this.runtimeSources.setupStatus.getSnapshot();
    const locale =
      this.runtimeSources.setupStatus.getLocale?.() ??
      snapshot.locale ??
      DEFAULT_DIRONG_LOCALE;

    sendJson(response, withMessageKeys(locale, {
      ok: true,
      status: "ready",
      locale,
      notionSchemaLocale: locale,
      messageKey: "settings.language.current.message",
      userActionKey: null,
    }));
  }

  private async handleLanguageSave(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (!this.runtimeSources.setupStatus?.setLocale) {
      sendJson(response, withMessageKeys(DEFAULT_DIRONG_LOCALE, {
        ok: false,
        status: "not_configured",
        locale: DEFAULT_DIRONG_LOCALE,
        notionSchemaLocale: DEFAULT_DIRONG_LOCALE,
        messageKey: "error.dashboard.settingsSourceMissing.message",
        userActionKey: "error.dashboard.settingsSourceMissing.action",
      }));
      return;
    }

    try {
      const body = await readJsonBody(request);
      const locale = readLocaleBody(body);
      if (!locale) {
        const responseLocale = this.getResponseLocale();
        sendJson(response, withMessageKeys(responseLocale, {
          ok: false,
          status: "failed",
          locale: responseLocale,
          notionSchemaLocale: responseLocale,
          messageKey: "settings.language.error.invalidLocale.message",
          userActionKey: "settings.language.error.invalidLocale.action",
        }), 400);
        return;
      }

      const setup = this.runtimeSources.setupStatus.setLocale(locale);
      sendJson(response, withMessageKeys(setup.locale, {
        ok: true,
        status: "done",
        locale: setup.locale,
        notionSchemaLocale: setup.notionSchemaLocale,
        messageKey: "settings.language.save.done.message",
        userActionKey: null,
        setup,
      }));
    } catch (error) {
      const responseLocale = this.getResponseLocale();
      const detail = error instanceof Error ? error.message : String(error);
      sendJson(response, redactForJson(withMessageKeys(responseLocale, {
        ok: false,
        status: "failed",
        locale: responseLocale,
        notionSchemaLocale: responseLocale,
        messageKey: "error.dashboard.requestInvalid.message",
        userActionKey: "error.dashboard.requestInvalid.action",
        detail,
      })), 400);
    }
  }

  private handleThemeGet(response: ServerResponse): void {
    const locale = this.getResponseLocale();
    const snapshot = this.runtimeSources.setupStatus?.getSnapshot();
    const theme =
      this.runtimeSources.setupStatus?.getTheme?.() ??
      snapshot?.dashboardTheme ??
      DEFAULT_DIRONG_DASHBOARD_THEME;

    sendJson(response, withMessageKeys(locale, {
      ok: true,
      status: "ready",
      theme,
      messageKey: "settings.theme.current.message",
      userActionKey: null,
    }));
  }

  private async handleThemeSave(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const responseLocale = this.getResponseLocale();
    if (!this.runtimeSources.setupStatus?.setTheme) {
      sendJson(response, withMessageKeys(responseLocale, {
        ok: false,
        status: "not_configured",
        theme: DEFAULT_DIRONG_DASHBOARD_THEME,
        messageKey: "error.dashboard.settingsSourceMissing.message",
        userActionKey: "error.dashboard.settingsSourceMissing.action",
      }));
      return;
    }

    try {
      const body = await readJsonBody(request);
      const theme = readThemeBody(body);
      if (!theme) {
        sendJson(response, withMessageKeys(responseLocale, {
          ok: false,
          status: "failed",
          theme: DEFAULT_DIRONG_DASHBOARD_THEME,
          messageKey: "settings.theme.error.invalidTheme.message",
          userActionKey: "settings.theme.error.invalidTheme.action",
        }), 400);
        return;
      }

      const setup = this.runtimeSources.setupStatus.setTheme(theme);
      sendJson(response, withMessageKeys(setup.locale, {
        ok: true,
        status: "done",
        theme: setup.dashboardTheme,
        messageKey: "settings.theme.save.done.message",
        userActionKey: null,
        setup,
      }));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      sendJson(response, redactForJson(withMessageKeys(responseLocale, {
        ok: false,
        status: "failed",
        theme: DEFAULT_DIRONG_DASHBOARD_THEME,
        messageKey: "error.dashboard.requestInvalid.message",
        userActionKey: "error.dashboard.requestInvalid.action",
        detail,
      })), 400);
    }
  }

  private handleI18nGet(response: ServerResponse): void {
    const locale = this.getResponseLocale();
    const keys = listLocaleKeys(catalogs[locale] ?? catalogs.ko);
    sendJson(response, {
      locale,
      messages: Object.fromEntries(keys.map((key) => [key, t(locale, key)])),
    });
  }

  private async handleSetupWizardPost(
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
  ): Promise<void> {
    const locale = this.getResponseLocale();
    const setupWizard = this.runtimeSources.setupWizard;
    if (!setupWizard) {
      sendJson(response, withMessageKeys(locale, {
        ok: false,
        status: "not_configured",
        messageKey: "error.dashboard.setupWizardSourceMissing.message",
        userActionKey: "error.dashboard.setupWizardSourceMissing.action",
      }), 500);
      return;
    }

    try {
      const body = await readJsonBody(request);
      if (pathname === "/api/setup/discord/application-id") {
        sendWizardResult(response, setupWizard.saveDiscordApplicationId(body));
        return;
      }
      if (pathname === "/api/setup/discord/bot-token") {
        sendWizardResult(response, setupWizard.saveDiscordBotToken(body));
        return;
      }
      if (pathname === "/api/setup/discord/test") {
        sendWizardResult(response, await setupWizard.testDiscordConnection());
        return;
      }
      if (pathname === "/api/setup/discord/guild-allowlist") {
        sendWizardResult(response, await setupWizard.saveDiscordGuildAllowlist(body));
        return;
      }
      if (pathname === "/api/setup/stt") {
        sendWizardResult(response, setupWizard.saveSttSettings(body));
        return;
      }
      if (pathname === "/api/setup/ai/claude") {
        sendWizardResult(response, setupWizard.saveClaudeSettings(body));
        return;
      }
      if (pathname === "/api/setup/ai/claude/test") {
        sendWizardResult(response, await setupWizard.testClaudeConnection());
        return;
      }
      if (pathname === "/api/setup/notion/token") {
        sendWizardResult(response, setupWizard.saveNotionToken(body));
        return;
      }
      if (pathname === "/api/setup/notion/parent-page") {
        sendWizardResult(response, setupWizard.saveNotionParentPageUrl(body));
        return;
      }
      if (pathname === "/api/setup/notion/verify-parent-page") {
        sendWizardResult(response, await setupWizard.verifyNotionParentPage());
        return;
      }
      if (pathname === "/api/setup/notion/managed-databases") {
        sendWizardResult(response, await setupWizard.createManagedDatabases());
        return;
      }
      sendJson(response, withMessageKeys(locale, {
        ok: false,
        status: "failed",
        messageKey: "error.dashboard.requestInvalid.message",
        userActionKey: "error.dashboard.requestInvalid.action",
      }), 404);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      sendJson(response, redactForJson(withMessageKeys(locale, {
        ok: false,
        status: "failed",
        messageKey: "error.dashboard.requestInvalid.message",
        userActionKey: "error.dashboard.requestInvalid.action",
        detail,
      })), 400);
    }
  }

  private serveAudio(
    request: IncomingMessage,
    response: ServerResponse,
    chunkId: string,
    kind: "raw" | "stt",
  ): void {
    const audio = this.store.getAudioPathForChunk(chunkId, kind);
    if (!audio || !existsSync(audio.path)) {
      sendText(response, 404, "Audio Not Found");
      return;
    }

    const fileStat = statSync(audio.path);
    const range = request.headers.range;
    const contentType = contentTypeForAudio(audio.format, audio.path);
    const baseHeaders = {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Accept-Ranges": "bytes",
    };

    if (range) {
      const parsed = /^bytes=(\d*)-(\d*)$/.exec(range);
      const start = parsed?.[1] ? Number(parsed[1]) : 0;
      const end = parsed?.[2] ? Number(parsed[2]) : fileStat.size - 1;

      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        end >= fileStat.size ||
        start > end
      ) {
        response.writeHead(416, {
          ...baseHeaders,
          "Content-Range": `bytes */${fileStat.size}`,
        });
        response.end();
        return;
      }

      response.writeHead(206, {
        ...baseHeaders,
        "Content-Length": end - start + 1,
        "Content-Range": `bytes ${start}-${end}/${fileStat.size}`,
      });
      createReadStream(audio.path, { start, end }).pipe(response);
      return;
    }

    response.writeHead(200, {
      ...baseHeaders,
      "Content-Length": fileStat.size,
    });
    createReadStream(audio.path).pipe(response);
  }

  private serveAsset(response: ServerResponse, pathname: string): void {
    const relativePath = decodeURIComponent(pathname.replace(/^\/assets\//, ""));
    if (!relativePath || relativePath.includes("\0")) {
      sendText(response, 404, "Asset Not Found");
      return;
    }

    const targetPath = path.resolve(DASHBOARD_ASSET_ROOT, relativePath);
    const rootPrefix = `${DASHBOARD_ASSET_ROOT}${path.sep}`;
    if (targetPath !== DASHBOARD_ASSET_ROOT && !targetPath.startsWith(rootPrefix)) {
      sendText(response, 404, "Asset Not Found");
      return;
    }
    if (!existsSync(targetPath) || statSync(targetPath).isDirectory()) {
      sendText(response, 404, "Asset Not Found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": contentTypeForAsset(targetPath),
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    });
    createReadStream(targetPath).pipe(response);
  }

  private async handleNotionAction(
    request: IncomingMessage,
    response: ServerResponse,
    force: boolean,
  ): Promise<void> {
    const locale = this.getResponseLocale();
    if (!this.runtimeSources.notion) {
      sendJson(response, withMessageKeys(locale, {
        ok: false,
        status: "not_configured",
        messageKey: "error.dashboard.notionActionSourceMissing.message",
        userActionKey: "error.dashboard.notionActionSourceMissing.action",
        pageUrl: null,
      }));
      return;
    }

    try {
      const body = await readJsonBody(request);
      const result = await this.runtimeSources.notion.runManualUpload({
        sessionId: readOptionalBodyString(body, "sessionId"),
        draftId: readOptionalBodyString(body, "draftId"),
        force,
      });
      sendJson(response, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const localized = withMessageKeys(locale, {
        messageKey: "error.dashboard.requestInvalid.message",
        userActionKey: "action.request.retry",
        status: "failed",
        technicalDetail: message,
      });
      sendJson(response, {
        ok: false,
        pageUrl: null,
        ...localized,
      }, 400);
    }
  }

  private async handleNotionPropertiesSync(
    response: ServerResponse,
  ): Promise<void> {
    const locale = this.getResponseLocale();
    if (!this.runtimeSources.notion) {
      sendJson(response, withMessageKeys(locale, {
        ok: false,
        status: "not_configured",
        messageKey: "error.dashboard.notionActionSourceMissing.message",
        userActionKey: "error.dashboard.notionActionSourceMissing.action",
        warnings: [],
        customProperties: null,
      }));
      return;
    }

    const result = await this.runtimeSources.notion.syncCustomProperties();
    sendJson(response, result);
  }

  private async handleNotionPropertiesSave(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const locale = this.getResponseLocale();
    if (!this.runtimeSources.notion) {
      sendJson(response, withMessageKeys(locale, {
        ok: false,
        status: "not_configured",
        messageKey: "error.dashboard.notionActionSourceMissing.message",
        userActionKey: "error.dashboard.notionActionSourceMissing.action",
        warnings: [],
        customProperties: null,
      }));
      return;
    }

    try {
      const body = await readJsonBody(request);
      const result = this.runtimeSources.notion.saveCustomPropertyRules(
        readCustomPropertyRuleInputs(body),
      );
      sendJson(response, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const localized = withMessageKeys(locale, {
        messageKey: "error.dashboard.requestInvalid.message",
        userActionKey: "action.request.retry",
        status: "failed",
        technicalDetail: message,
      });
      sendJson(response, {
        ok: false,
        warnings: [],
        customProperties: null,
        ...localized,
      }, 400);
    }
  }

  private async handleNotionSchemaInspect(
    response: ServerResponse,
  ): Promise<void> {
    const locale = this.getResponseLocale();
    if (!this.runtimeSources.notion) {
      sendJson(response, withMessageKeys(locale, {
        ok: false,
        status: "not_configured",
        messageKey: "error.dashboard.notionActionSourceMissing.message",
        userActionKey: "error.dashboard.notionActionSourceMissing.action",
        warnings: [],
        diff: null,
        operations: null,
      }));
      return;
    }

    const result = await this.runtimeSources.notion.inspectSchema();
    sendJson(response, result);
  }

  private async handleNotionSchemaApply(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const locale = this.getResponseLocale();
    if (!this.runtimeSources.notion) {
      sendJson(response, withMessageKeys(locale, {
        ok: false,
        status: "not_configured",
        messageKey: "error.dashboard.notionActionSourceMissing.message",
        userActionKey: "error.dashboard.notionActionSourceMissing.action",
        warnings: [],
        diff: null,
        operations: null,
      }));
      return;
    }

    try {
      const body = await readJsonBody(request);
      const result = await this.runtimeSources.notion.applySchema(
        readNotionSchemaApplyOptions(body),
      );
      sendJson(response, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const localized = withMessageKeys(locale, {
        messageKey: "error.dashboard.requestInvalid.message",
        userActionKey: "action.request.retry",
        status: "failed",
        technicalDetail: message,
      });
      sendJson(response, {
        ok: false,
        warnings: [],
        diff: null,
        operations: null,
        ...localized,
      }, 400);
    }
  }
}

export function appendAiReadinessToDashboardState(
  state: unknown,
  aiReadinessSource?: DashboardAiReadinessSource,
): unknown {
  return appendDashboardRuntimeSnapshots(state, {
    aiReadiness: aiReadinessSource,
  });
}

export function appendDashboardRuntimeSnapshots(
  state: unknown,
  sources: DashboardRuntimeSources = {},
): unknown {
  if (!isRecord(state)) {
    return state;
  }
  if (
    !sources.aiReadiness &&
    !sources.aiCleanupAutomation &&
    !sources.aloneFinalize &&
    !sources.notion &&
    !sources.notionAutomation &&
    !sources.setupStatus &&
    !sources.sttAutomation
  ) {
    return state;
  }

  return {
    ...state,
    ...(sources.aiReadiness
      ? { aiReadiness: sources.aiReadiness.getSnapshot() }
      : {}),
    ...(sources.aiCleanupAutomation
      ? { aiCleanupAutomation: sources.aiCleanupAutomation.getSnapshot() }
      : {}),
    ...(sources.aloneFinalize
      ? { aloneFinalize: sources.aloneFinalize.getSnapshot() }
      : {}),
    ...(sources.notion
      ? { notion: sources.notion.getSnapshot() }
      : {}),
    ...(sources.notionAutomation
      ? { notionAutomation: sources.notionAutomation.getSnapshot() }
      : {}),
    ...(sources.setupStatus
      ? { setup: sources.setupStatus.getSnapshot() }
      : {}),
    ...(sources.setupWizard
      ? { setupWizard: sources.setupWizard.getState().wizard }
      : {}),
    ...(sources.sttAutomation
      ? { sttAutomation: sources.sttAutomation.getSnapshot() }
      : {}),
  };
}

const DASHBOARD_INDEX_HTML = readFileSync(new URL("./public/index.html", import.meta.url), "utf8");
const DASHBOARD_ASSET_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../assets",
);

function sendHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(html);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sendJson(
  response: ServerResponse,
  value: unknown,
  statusCode = 200,
): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(`${JSON.stringify(redactForJson(value))}\n`);
}

function sendWizardResult(
  response: ServerResponse,
  result: SetupWizardActionResult,
): void {
  const { httpStatus, ...body } = result;
  sendJson(response, body, httpStatus);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 65536) {
      throw new Error("Dashboard request body is too large.");
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) {
    return {};
  }
  return JSON.parse(text);
}

function readLocaleBody(body: unknown): DirongLocale | null {
  if (!isRecord(body)) {
    return null;
  }
  return isDirongLocale(body.locale) ? body.locale : null;
}

function readThemeBody(body: unknown): DirongDashboardTheme | null {
  if (!isRecord(body)) {
    return null;
  }
  return isDirongDashboardTheme(body.theme) ? body.theme : null;
}

function readOptionalBodyString(body: unknown, key: string): string | null {
  if (!isRecord(body)) {
    return null;
  }
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readCustomPropertyRuleInputs(
  body: unknown,
): NotionCustomPropertyRuleInput[] {
  if (!isRecord(body) || !Array.isArray(body.rules)) {
    return [];
  }

  const rules: NotionCustomPropertyRuleInput[] = [];
  for (const entry of body.rules) {
    if (!isRecord(entry) || typeof entry.propertyName !== "string") {
      continue;
    }
    rules.push({
      originalPropertyName:
        typeof entry.originalPropertyName === "string"
          ? entry.originalPropertyName
          : null,
      propertyName: entry.propertyName,
      propertyType:
        typeof entry.propertyType === "string" ? entry.propertyType : null,
      valueSource:
        typeof entry.valueSource === "string" ? entry.valueSource : null,
      enabled: entry.enabled === true,
      promptDescription:
        typeof entry.promptDescription === "string"
          ? entry.promptDescription
          : "",
      maxLength:
        typeof entry.maxLength === "number" && Number.isFinite(entry.maxLength)
          ? entry.maxLength
          : null,
      relationTargetUrl:
        typeof entry.relationTargetUrl === "string"
          ? entry.relationTargetUrl
          : null,
      relationDataSourceId:
        typeof entry.relationDataSourceId === "string"
          ? entry.relationDataSourceId
          : null,
      relationTargetPageUrl:
        typeof entry.relationTargetPageUrl === "string"
          ? entry.relationTargetPageUrl
          : null,
      relationTargetPageId:
        typeof entry.relationTargetPageId === "string"
          ? entry.relationTargetPageId
          : null,
      relationMatchPropertyName:
        typeof entry.relationMatchPropertyName === "string"
          ? entry.relationMatchPropertyName
          : null,
      relationAutoCreate: entry.relationAutoCreate === true,
      deleted: entry.deleted === true,
    });
  }
  return rules;
}

function readNotionSchemaApplyOptions(body: unknown): NotionSchemaApplyOptions {
  const record = isRecord(body) ? body : {};
  return {
    createMissing: record.createMissing !== false,
    updateTypes: record.updateTypes === true,
    deleteExtra: false,
    confirmDeleteExtra: false,
  };
}

function withMessageKeys<T>(
  locale: DirongLocale,
  input: T & { messageKey: LocaleKey; userActionKey: LocaleKey | null },
): T & {
  message: string;
  userAction: string | null;
  display: HumanStatusDisplay;
} {
  const message = t(locale, input.messageKey);
  const userAction = input.userActionKey ? t(locale, input.userActionKey) : null;
  return {
    ...input,
    message,
    userAction,
    display: buildHumanStatusDisplay(locale, {
      ...dashboardDisplayKeys(input.messageKey),
      status: readStatusValue(input),
      message,
      userAction,
      technicalDetail: readStringValue(input, "technicalDetail") ?? readStringValue(input, "detail"),
      messageKey: input.messageKey,
      userActionKey: input.userActionKey,
    }),
  };
}

function dashboardDisplayKeys(
  messageKey: LocaleKey,
): Pick<
  HumanStatusDisplayInput,
  "titleKey" | "descriptionKey" | "nextActionKey"
> {
  if (
    messageKey === "error.dashboard.setupStatusSourceMissing.message" ||
    messageKey === "error.dashboard.settingsSourceMissing.message" ||
    messageKey === "error.dashboard.setupWizardSourceMissing.message" ||
    messageKey === "error.dashboard.notionActionSourceMissing.message"
  ) {
    return {
      titleKey: "statusDisplay.dashboard.sourceMissing.title",
      descriptionKey: "statusDisplay.dashboard.sourceMissing.description",
      nextActionKey: "statusDisplay.dashboard.sourceMissing.nextAction",
    };
  }
  if (
    messageKey === "error.dashboard.requestInvalid.message" ||
    messageKey === "settings.language.error.invalidLocale.message" ||
    messageKey === "settings.theme.error.invalidTheme.message"
  ) {
    return {
      titleKey: "statusDisplay.dashboard.requestInvalid.title",
      descriptionKey: "statusDisplay.dashboard.requestInvalid.description",
      nextActionKey: "statusDisplay.dashboard.requestInvalid.nextAction",
    };
  }
  if (messageKey === "settings.language.save.done.message") {
    return {
      titleKey: "statusDisplay.action.done.title",
      descriptionKey: "statusDisplay.action.done.description",
    };
  }
  if (messageKey === "settings.theme.save.done.message") {
    return {
      titleKey: "statusDisplay.action.done.title",
      descriptionKey: "statusDisplay.action.done.description",
    };
  }
  return {
    titleKey: "statusDisplay.action.ready.title",
    descriptionKey: "statusDisplay.action.ready.description",
  };
}

function readStatusValue(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }
  return typeof value.status === "string" ? value.status : null;
}

function readStringValue(value: unknown, key: string): string | null {
  if (!isRecord(value)) {
    return null;
  }
  const entry = value[key];
  return typeof entry === "string" ? entry : null;
}

function sendText(response: ServerResponse, statusCode: number, text: string): void {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(text);
}

function contentTypeForAudio(format: string, filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (format.includes("wav") || ext === ".wav") {
    return "audio/wav";
  }
  if (format.includes("webm") || ext === ".webm") {
    return "audio/webm";
  }
  return "audio/ogg";
}

function contentTypeForAsset(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") {
    return "image/png";
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    return "image/jpeg";
  }
  if (ext === ".webp") {
    return "image/webp";
  }
  if (ext === ".svg") {
    return "image/svg+xml";
  }
  return "application/octet-stream";
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
