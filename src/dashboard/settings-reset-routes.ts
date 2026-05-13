import type { IncomingMessage, ServerResponse } from "node:http";
import { redactForJson } from "../errors.js";
import type { SettingsResetMode } from "../settings/reset-service.js";
import { isRecord, readJsonBody, sendJson, withMessageKeys } from "./http.js";
import type { DashboardRuntimeSources } from "./server.js";
import { getDashboardResponseLocale } from "./setup-routes.js";

export async function handleSettingsResetPost(
  request: IncomingMessage,
  response: ServerResponse,
  sources: DashboardRuntimeSources,
): Promise<void> {
  const locale = getDashboardResponseLocale(sources);
  if (!sources.settingsReset) {
    sendJson(response, withMessageKeys(locale, {
      ok: false,
      status: "not_configured",
      messageKey: "error.dashboard.settingsSourceMissing.message",
      userActionKey: "error.dashboard.settingsSourceMissing.action",
    }), 500);
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    sendJson(response, redactForJson(withMessageKeys(locale, {
      ok: false,
      status: "failed",
      messageKey: "error.dashboard.requestInvalid.message",
      userActionKey: "error.dashboard.requestInvalid.action",
      detail,
    })), 400);
    return;
  }

  const mode = readResetMode(body);
  const confirm = isRecord(body) && body.confirm === true;
  if (!mode || !confirm) {
    sendJson(response, withMessageKeys(locale, {
      ok: false,
      status: "failed",
      messageKey: "error.dashboard.requestInvalid.message",
      userActionKey: "error.dashboard.requestInvalid.action",
    }), 400);
    return;
  }

  try {
    const result = await sources.settingsReset.reset({ mode, confirm: true });
    sendJson(response, result, result.ok ? 200 : result.httpStatus);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    sendJson(response, redactForJson({
      ok: false,
      status: "failed",
      message: "Settings reset failed.",
      detail,
    }), 500);
  }
}

function readResetMode(body: unknown): SettingsResetMode | null {
  if (!isRecord(body)) {
    return null;
  }
  return body.mode === "full" || body.mode === "current_project_connection"
    ? body.mode
    : null;
}
