import type { IncomingMessage, ServerResponse } from "node:http";
import { redactForJson } from "../errors.js";
import { t, type LocaleKey } from "../i18n/catalog.js";
import {
  buildHumanStatusDisplay,
  type HumanStatusDisplay,
  type HumanStatusDisplayInput,
} from "../messages/human-status.js";
import type { DirongLocale } from "../settings/local-settings-store.js";

export function sendHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(html);
}

export function sendJson(
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

export function sendTrustedJson(
  response: ServerResponse,
  value: unknown,
  statusCode = 200,
): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(`${JSON.stringify(value)}\n`);
}

export function sendText(
  response: ServerResponse,
  statusCode: number,
  text: string,
): void {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(text);
}

export async function readJsonBody(
  request: IncomingMessage,
): Promise<unknown> {
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

export function readOptionalBodyString(
  body: unknown,
  key: string,
): string | null {
  if (!isRecord(body)) {
    return null;
  }
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function withMessageKeys<T>(
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
      technicalDetail:
        readStringValue(input, "technicalDetail") ??
        readStringValue(input, "detail"),
      messageKey: input.messageKey,
      userActionKey: input.userActionKey,
    }),
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
