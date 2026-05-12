import { formatLocaleText, t } from "./i18n/catalog.js";
import type { DirongLocale } from "./settings/local-settings-store.js";

const SENSITIVE_KEY_PATTERN = /token|authorization|api[_-]?key|secret|password/i;
export const DEFAULT_REGISTERED_SENSITIVE_VALUE_LIMIT = 256;
const registeredSensitiveValues = new Set<string>();

export class MissingRequiredConfigError extends Error {
  constructor(public readonly missingKeys: string[]) {
    super(`Missing required configuration: ${missingKeys.join(", ")}`);
    this.name = "MissingRequiredConfigError";
  }
}

export class DirongError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DirongError";
  }
}

export type SafeErrorInfo = {
  name: string;
  message: string;
  code?: unknown;
  status?: unknown;
};

export function registerSensitiveValue(value: string | null | undefined): void {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length < 8) {
    return;
  }
  registeredSensitiveValues.delete(trimmed);
  registeredSensitiveValues.add(trimmed);
  while (registeredSensitiveValues.size > DEFAULT_REGISTERED_SENSITIVE_VALUE_LIMIT) {
    const oldest = registeredSensitiveValues.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    registeredSensitiveValues.delete(oldest);
  }
}

export function getRegisteredSensitiveValueCount(): number {
  return registeredSensitiveValues.size;
}

export function summarizeSafeError(error: unknown, maxLength = 1000): string {
  const message = error instanceof Error ? error.message : String(error);
  return summarizeSafeText(message, maxLength);
}

export function summarizeSafeText(value: string, maxLength = 1000): string {
  const redacted = redactSensitiveText(value);
  if (redacted.length <= maxLength) {
    return redacted;
  }
  return `${redacted.slice(0, Math.max(0, maxLength))}...`;
}

export function redactSensitiveText(value: string): string {
  let redacted = value;
  const token = process.env.DISCORD_BOT_TOKEN;
  const openAiApiKey = process.env.OPENAI_API_KEY;
  const notionApiKey = process.env.NOTION_API_KEY;

  if (token && token.length > 0) {
    redacted = redacted.split(token).join("[REDACTED_DISCORD_BOT_TOKEN]");
  }
  if (openAiApiKey && openAiApiKey.length > 0) {
    redacted = redacted.split(openAiApiKey).join("[REDACTED_OPENAI_API_KEY]");
  }
  if (notionApiKey && notionApiKey.length > 0) {
    redacted = redacted.split(notionApiKey).join("[REDACTED_NOTION_API_KEY]");
  }
  for (const secret of registeredSensitiveValues) {
    redacted = redacted.split(secret).join("[REDACTED_SECRET]");
  }

  redacted = redacted.replace(
    /\bBot\s+[A-Za-z0-9._-]{20,}\b/gi,
    "Bot [REDACTED]",
  );
  redacted = redacted.replace(
    /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g,
    "[REDACTED_OPENAI_API_KEY]",
  );
  redacted = redacted.replace(
    /\bntn_[A-Za-z0-9_-]{10,}\b/g,
    "[REDACTED_NOTION_API_KEY]",
  );
  redacted = redacted.replace(
    /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
    "[REDACTED_ANTHROPIC_API_KEY]",
  );
  redacted = redacted.replace(
    /([A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{20,})/g,
    "[REDACTED_DISCORD_TOKEN_LIKE_VALUE]",
  );
  redacted = redacted.replace(
    /\b(authorization|token|secret|api[_-]?key)(\s*[:=]\s*)([^"',\s}]+)/gi,
    "$1$2[REDACTED]",
  );
  redacted = redacted.replace(
    /\bauthorization\s*[:=]?\s*bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    "authorization [REDACTED]",
  );

  return redacted;
}

export function redactForJson(value: unknown, depth = 0): unknown {
  if (depth > 8) {
    return "[MAX_DEPTH]";
  }

  if (typeof value === "string") {
    return redactSensitiveText(value);
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactForJson(item, depth + 1));
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY_PATTERN.test(key)
      && !isSafeSecretPresenceSnapshot(entry)
      && !isSafeSecretPresenceMap(entry)
      ? "[REDACTED]"
      : redactForJson(entry, depth + 1);
  }

  return output;
}

function isSafeSecretPresenceSnapshot(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return (
    keys.length === 2
    && typeof record.configured === "boolean"
    && (record.displayValue === "[REDACTED]" || record.displayValue === "[MISSING]")
  );
}

function isSafeSecretPresenceMap(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const entries = Object.values(value as Record<string, unknown>);
  return entries.length > 0 && entries.every(isSafeSecretPresenceSnapshot);
}

export function safeErrorInfo(error: unknown): SafeErrorInfo {
  if (error instanceof Error) {
    const maybeError = error as Error & {
      code?: unknown;
      status?: unknown;
      rawError?: unknown;
    };

    return {
      name: maybeError.name,
      message: redactSensitiveText(maybeError.message),
      code: maybeError.code,
      status: maybeError.status,
    };
  }

  return {
    name: "UnknownError",
    message: redactSensitiveText(String(error)),
  };
}

export function toKoreanErrorMessage(error: unknown): string {
  return toLocalizedErrorMessage(error, "ko");
}

export function toLocalizedErrorMessage(
  error: unknown,
  locale: DirongLocale,
): string {
  if (error instanceof MissingRequiredConfigError) {
    return [
      t(locale, "error.common.missingConfig"),
      formatLocaleText(locale, "error.common.missingKeys", {
        keys: error.missingKeys.join(", "),
      }),
      t(locale, "error.common.copyEnvExample"),
    ].join(" ");
  }

  const info = safeErrorInfo(error);
  const message = info.message.toLowerCase();
  const code = String(info.code ?? "").toLowerCase();

  if (
    message.includes("token") ||
    message.includes("unauthorized") ||
    code.includes("token_invalid") ||
    code === "50014" ||
    code === "401"
  ) {
    return t(locale, "error.discord.token");
  }

  if (
    message.includes("missing access") ||
    message.includes("missing permissions") ||
    code === "50001" ||
    code === "50013"
  ) {
    return t(locale, "error.discord.permissions");
  }

  if (message.includes("unknown guild") || code === "10004") {
    return t(locale, "error.discord.unknownGuild");
  }

  if (message.includes("unknown channel") || code === "10003") {
    return t(locale, "error.discord.unknownChannel");
  }

  if (message.includes("voice channel") || message.includes("not voice")) {
    return t(locale, "error.discord.voiceChannel");
  }

  if (message.includes("ffmpeg")) {
    return t(locale, "error.discord.ffmpeg");
  }

  if (message.includes("timed out") || message.includes("timeout")) {
    return t(locale, "error.discord.timeout");
  }

  return formatLocaleText(locale, "error.common.generic", {
    message: info.message,
  });
}
