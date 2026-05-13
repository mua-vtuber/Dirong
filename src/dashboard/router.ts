import type { IncomingMessage, ServerResponse } from "node:http";
import type { RecordingProducer } from "../recording/recording-producer.js";
import {
  buildDashboardHtml,
  requireJsonMutationRequest,
  verifySignedAudioToken,
  type DashboardAudioKind,
} from "./security.js";
import {
  appendDashboardRuntimeSnapshots,
  appendSignedAudioUrlsToDashboardState,
} from "./state.js";
import { sendHtml, sendJson, sendText } from "./http.js";
import {
  handleNotionAction,
  handleNotionMemberRosterSync,
  handleNotionManagedSchemaCheck,
  handleNotionManagedSchemaRepair,
  handleNotionPropertiesSave,
  handleNotionPropertiesSync,
  handleNotionSchemaApply,
  handleNotionSchemaInspect,
} from "./notion-routes.js";
import {
  getDashboardResponseLocale,
  handleI18nGet,
  handleLanguageGet,
  handleLanguageSave,
  handleSetupGuildsGet,
  handleSetupStatusGet,
  handleSetupWizardPost,
  handleThemeGet,
  handleThemeSave,
} from "./setup-routes.js";
import {
  DASHBOARD_INDEX_HTML,
  serveAudio,
  serveDashboardPublicAsset,
  serveProjectAsset,
} from "./static-assets.js";
import type { DashboardRuntimeSources } from "./server.js";
import type { DashboardStore } from "./storage-port.js";

export type DashboardRouteContext = {
  request: IncomingMessage;
  response: ServerResponse;
  getUrl(): string;
  dashboardToken: string;
  audioTokenSecret: string;
  store: DashboardStore;
  producer: RecordingProducer;
  runtimeSources: DashboardRuntimeSources;
};

export async function routeDashboardRequest(
  context: DashboardRouteContext,
): Promise<void> {
  const { request, response } = context;
  const url = new URL(request.url ?? "/", context.getUrl());
  if (request.method === "POST") {
    const security = requireJsonMutationRequest({
      request,
      expectedOrigin: context.getUrl(),
      dashboardToken: context.dashboardToken,
    });
    if (!security.ok) {
      sendText(response, security.statusCode, security.message);
      return;
    }
  }

  const languageEndpoint =
    url.pathname === "/api/settings/language" ||
    url.pathname === "/api/setup/language";
  const themeEndpoint = url.pathname === "/api/settings/theme";

  if (request.method === "POST" && languageEndpoint) {
    await handleLanguageSave(request, response, context.runtimeSources);
    return;
  }

  if (request.method === "POST" && themeEndpoint) {
    await handleThemeSave(request, response, context.runtimeSources);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/setup/")) {
    await handleSetupWizardPost(
      request,
      response,
      context.runtimeSources,
      url.pathname,
    );
    return;
  }

  const locale = getDashboardResponseLocale(context.runtimeSources);

  if (request.method === "POST" && url.pathname === "/api/notion/send") {
    await handleNotionAction(
      request,
      response,
      context.runtimeSources,
      locale,
      false,
    );
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/notion/retry") {
    await handleNotionAction(
      request,
      response,
      context.runtimeSources,
      locale,
      true,
    );
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/notion/properties/sync"
  ) {
    await handleNotionPropertiesSync(
      request,
      response,
      context.runtimeSources,
      locale,
    );
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/notion/member-roster/sync"
  ) {
    await handleNotionMemberRosterSync(
      response,
      context.runtimeSources,
      locale,
    );
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/notion/properties") {
    await handleNotionPropertiesSave(
      request,
      response,
      context.runtimeSources,
      locale,
    );
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/notion/schema/inspect"
  ) {
    await handleNotionSchemaInspect(response, context.runtimeSources, locale);
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/notion/schema/apply"
  ) {
    await handleNotionSchemaApply(
      request,
      response,
      context.runtimeSources,
      locale,
    );
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/notion/managed-schema/check"
  ) {
    await handleNotionManagedSchemaCheck(
      response,
      context.runtimeSources,
      locale,
    );
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/notion/managed-schema/repair"
  ) {
    await handleNotionManagedSchemaRepair(
      request,
      response,
      context.runtimeSources,
      locale,
    );
    return;
  }

  if (request.method !== "GET") {
    sendText(response, 405, "Method Not Allowed");
    return;
  }

  if (url.pathname === "/") {
    sendHtml(response, buildDashboardHtml(
      DASHBOARD_INDEX_HTML,
      context.dashboardToken,
    ));
    return;
  }

  if (url.pathname === "/api/state") {
    const state = context.store.getDashboardState(
      context.producer.getRuntimeState(),
    );
    const withRuntime = appendDashboardRuntimeSnapshots(
      state,
      context.runtimeSources,
    );
    sendJson(
      response,
      appendSignedAudioUrlsToDashboardState(
        withRuntime,
        context.audioTokenSecret,
      ),
    );
    return;
  }

  if (url.pathname === "/api/setup/status" || url.pathname === "/api/setup/state") {
    handleSetupStatusGet(response, context.runtimeSources);
    return;
  }

  if (url.pathname === "/api/setup/discord/guilds") {
    await handleSetupGuildsGet(response, context.runtimeSources);
    return;
  }

  if (languageEndpoint) {
    handleLanguageGet(response, context.runtimeSources);
    return;
  }

  if (themeEndpoint) {
    handleThemeGet(response, context.runtimeSources);
    return;
  }

  if (url.pathname === "/api/i18n") {
    handleI18nGet(response, context.runtimeSources);
    return;
  }

  if (url.pathname.startsWith("/dashboard/")) {
    serveDashboardPublicAsset(response, url.pathname);
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    serveProjectAsset(response, url.pathname);
    return;
  }

  const audioMatch = /^\/audio\/([^/]+)\/(raw|stt)$/.exec(url.pathname);
  if (audioMatch) {
    const chunkId = decodeURIComponent(audioMatch[1] ?? "");
    const kind = (audioMatch[2] ?? "raw") as DashboardAudioKind;
    if (
      !verifySignedAudioToken({
        chunkId,
        kind,
        secret: context.audioTokenSecret,
        token: url.searchParams.get("token"),
      })
    ) {
      sendText(response, 403, "Forbidden");
      return;
    }
    serveAudio({
      request,
      response,
      store: context.store,
      chunkId,
      kind,
    });
    return;
  }

  sendText(response, 404, "Not Found");
}
