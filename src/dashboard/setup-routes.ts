import type { IncomingMessage, ServerResponse } from "node:http";
import { redactForJson } from "../errors.js";
import { resolveAppLocale } from "../i18n/app-locale.js";
import { catalogs, listLocaleKeys, t } from "../i18n/catalog.js";
import {
  DEFAULT_DIRONG_DASHBOARD_THEME,
  DEFAULT_DIRONG_LOCALE,
  isDirongDashboardTheme,
  isDirongLocale,
  type DirongDashboardTheme,
  type DirongLocale,
} from "../settings/local-settings-store.js";
import { buildSettingsRuntimeEffect } from "../settings/product-settings.js";
import type { SetupWizardActionResult } from "../setup/wizard-service.js";
import {
  isRecord,
  readJsonBody,
  sendJson,
  sendTrustedJson,
  withMessageKeys,
} from "./http.js";
import type { DashboardRuntimeSources } from "./server.js";

export function getDashboardResponseLocale(
  sources: DashboardRuntimeSources,
): DirongLocale {
  return resolveAppLocale({
    getLocale: () => sources.setupStatus?.getLocale?.(),
    locale: sources.setupStatus?.getSnapshot().locale,
  });
}

export function handleSetupStatusGet(
  response: ServerResponse,
  sources: DashboardRuntimeSources,
): void {
  if (sources.setupWizard) {
    sendJson(response, sources.setupWizard.getState());
    return;
  }
  if (!sources.setupStatus) {
    sendJson(response, withMessageKeys(DEFAULT_DIRONG_LOCALE, {
      status: "not_configured",
      messageKey: "error.dashboard.setupStatusSourceMissing.message",
      userActionKey: "error.dashboard.setupStatusSourceMissing.action",
    }));
    return;
  }
  sendJson(response, sources.setupStatus.getSnapshot());
}

export async function handleSetupGuildsGet(
  response: ServerResponse,
  sources: DashboardRuntimeSources,
): Promise<void> {
  if (!sources.setupWizard) {
    sendJson(response, withMessageKeys(getDashboardResponseLocale(sources), {
      ok: false,
      status: "not_configured",
      messageKey: "error.dashboard.setupWizardSourceMissing.message",
      userActionKey: "error.dashboard.setupWizardSourceMissing.action",
      guilds: [],
    }), 500);
    return;
  }
  sendWizardResult(response, await sources.setupWizard.listDiscordGuilds());
}

export function handleLanguageGet(
  response: ServerResponse,
  sources: DashboardRuntimeSources,
): void {
  if (!sources.setupStatus) {
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

  const snapshot = sources.setupStatus.getSnapshot();
  const locale = resolveAppLocale({
    getLocale: () => sources.setupStatus?.getLocale?.(),
    locale: snapshot.locale,
  });

  sendJson(response, withMessageKeys(locale, {
    ok: true,
    status: "ready",
    locale,
    notionSchemaLocale: locale,
    messageKey: "settings.language.current.message",
    userActionKey: null,
  }));
}

export async function handleLanguageSave(
  request: IncomingMessage,
  response: ServerResponse,
  sources: DashboardRuntimeSources,
): Promise<void> {
  if (!sources.setupStatus?.setLocale) {
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
      const responseLocale = getDashboardResponseLocale(sources);
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

    const setup = sources.setupStatus.setLocale(locale);
    sendJson(response, withMessageKeys(setup.locale, {
      ok: true,
      status: "done",
      locale: setup.locale,
      notionSchemaLocale: setup.notionSchemaLocale,
      messageKey: "settings.language.save.done.message",
      userActionKey: null,
      runtimeEffect: buildSettingsRuntimeEffect(setup.locale, "dashboard"),
      setup,
    }));
  } catch (error) {
    const responseLocale = getDashboardResponseLocale(sources);
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

export function handleThemeGet(
  response: ServerResponse,
  sources: DashboardRuntimeSources,
): void {
  const locale = getDashboardResponseLocale(sources);
  const snapshot = sources.setupStatus?.getSnapshot();
  const theme =
    sources.setupStatus?.getTheme?.() ??
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

export async function handleThemeSave(
  request: IncomingMessage,
  response: ServerResponse,
  sources: DashboardRuntimeSources,
): Promise<void> {
  const responseLocale = getDashboardResponseLocale(sources);
  if (!sources.setupStatus?.setTheme) {
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

    const setup = sources.setupStatus.setTheme(theme);
    sendJson(response, withMessageKeys(setup.locale, {
      ok: true,
      status: "done",
      theme: setup.dashboardTheme,
      messageKey: "settings.theme.save.done.message",
      userActionKey: null,
      runtimeEffect: buildSettingsRuntimeEffect(setup.locale, "dashboard"),
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

export function handleI18nGet(
  response: ServerResponse,
  sources: DashboardRuntimeSources,
): void {
  const locale = getDashboardResponseLocale(sources);
  const keys = listLocaleKeys(catalogs[locale] ?? catalogs.ko);
  sendTrustedJson(response, {
    locale,
    messages: Object.fromEntries(keys.map((key) => [key, t(locale, key)])),
  });
}

export async function handleSetupWizardPost(
  request: IncomingMessage,
  response: ServerResponse,
  sources: DashboardRuntimeSources,
  pathname: string,
): Promise<void> {
  const locale = getDashboardResponseLocale(sources);
  const setupWizard = sources.setupWizard;
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
    if (pathname === "/api/setup/recording/alone-finalize") {
      if (!setupWizard.saveRecordingSettings) {
        sendJson(response, withMessageKeys(locale, {
          ok: false,
          status: "not_configured",
          messageKey: "error.dashboard.setupWizardSourceMissing.message",
          userActionKey: "error.dashboard.setupWizardSourceMissing.action",
        }), 500);
        return;
      }
      sendWizardResult(response, setupWizard.saveRecordingSettings(body));
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

function sendWizardResult(
  response: ServerResponse,
  result: SetupWizardActionResult,
): void {
  const { httpStatus, ...body } = result;
  sendJson(response, body, httpStatus);
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
