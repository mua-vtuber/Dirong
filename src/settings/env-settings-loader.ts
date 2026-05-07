import path from "node:path";
import dotenv from "dotenv";
import type {
  AiCleanupRuntimeSettings,
  AppSettings,
  SttProviderName,
  SttSettings,
} from "./app-settings.js";
import {
  DEFAULT_NOTION_API_VERSION,
  DEFAULT_NOTION_BASE_URL,
  DEFAULT_NOTION_PROPERTY_NAMES,
  validateNotionRuntimeSettings,
  type NotionIncludeTranscript,
  type NotionRuntimeSettings,
  type NotionTargetType,
  type NotionTemplateType,
  type NotionUploadMode,
} from "../notion/settings.js";
import {
  readBooleanEnv,
  readOptionalStringEnv,
  readPositiveNumberEnv,
} from "./env-readers.js";

export type EnvSettingsLoaderOptions = {
  allowTestNotionBaseUrl?: boolean;
  onInvalidBoolean?: (key: string, fallback: boolean) => void;
  onInvalidPositiveInteger?: (
    key: string,
    fallback: number,
  ) => "fallback" | void;
  onInvalidOptionalPositiveInteger?: (key: string) => "null" | void;
};

export function loadAppSettingsFromEnv(
  options: EnvSettingsLoaderOptions = {},
): AppSettings {
  dotenv.config({ path: path.resolve(process.cwd(), ".env"), quiet: true });
  return {
    stt: loadSttSettingsFromEnv(process.env),
    aiCleanup: loadAiCleanupSettingsFromEnv(process.env, options),
    notion: loadNotionSettingsFromEnv(process.env, options),
  };
}

export function loadSttSettingsFromEnv(
  env: NodeJS.ProcessEnv,
): SttSettings {
  const provider = readSttProvider(env.PHASE3_STT_PROVIDER);
  const language = readOptionalStringEnv(env, "PHASE3_STT_LANGUAGE") ?? "ko";
  const timeoutMs = readPositiveNumberEnv(env, "PHASE3_STT_TIMEOUT_MS", 120000, {
    invalidMessage: "PHASE3_STT_TIMEOUT_MS는 1 이상의 숫자여야 합니다.",
  });

  if (provider === "openai") {
    return {
      provider,
      language,
      timeoutMs,
      openai: {
        apiKey: readOptionalStringEnv(env, "OPENAI_API_KEY") ?? "",
        model:
          readOptionalStringEnv(env, "PHASE3_STT_MODEL") ??
          "gpt-4o-mini-transcribe",
      },
    };
  }

  return {
    provider,
    language,
    timeoutMs,
    localWhisper: {
      command: readOptionalStringEnv(env, "PHASE3_LOCAL_WHISPER_COMMAND") ?? "python",
      args: readCommandArgs(
        env.PHASE3_LOCAL_WHISPER_ARGS,
        "scripts/local-whisper-json.py",
      ),
      model: readOptionalStringEnv(env, "PHASE3_LOCAL_WHISPER_MODEL") ?? "small",
      device: readOptionalStringEnv(env, "PHASE3_LOCAL_WHISPER_DEVICE") ?? "cpu",
      computeType:
        readOptionalStringEnv(env, "PHASE3_LOCAL_WHISPER_COMPUTE_TYPE") ??
        "int8",
    },
  };
}

export function loadAiCleanupSettingsFromEnv(
  env: NodeJS.ProcessEnv,
  options: EnvSettingsLoaderOptions = {},
): AiCleanupRuntimeSettings {
  return {
    claudeCommand: readOptionalStringEnv(env, "PHASE4_CLAUDE_COMMAND") ?? "claude",
    claudeModel: readOptionalStringEnv(env, "PHASE4_CLAUDE_MODEL"),
    prepareTimeoutMs: readPositiveIntegerEnv(
      env,
      "PHASE4_AI_PREPARE_TIMEOUT_MS",
      5000,
      options,
    ),
    autoCleanupEnabled: readBooleanEnv(
      env,
      "PHASE4_AI_AUTO_CLEANUP_ENABLED",
      true,
      {
        onInvalid: () =>
          options.onInvalidBoolean?.("PHASE4_AI_AUTO_CLEANUP_ENABLED", true),
      },
    ),
    autoCleanupPollMs: readPositiveIntegerEnv(
      env,
      "PHASE4_AI_AUTO_CLEANUP_POLL_MS",
      5000,
      options,
    ),
    autoCleanupSessionBatchLimit: readPositiveIntegerEnv(
      env,
      "PHASE4_AI_AUTO_CLEANUP_SESSION_BATCH_LIMIT",
      3,
      options,
    ),
    readinessRetryMs: readPositiveIntegerEnv(
      env,
      "PHASE4_AI_READINESS_RETRY_MS",
      60000,
      options,
    ),
    leaseMs: readOptionalPositiveIntegerEnv(
      env,
      "PHASE4_AI_LEASE_MS",
      options,
    ),
    maxAttempts: readPositiveIntegerEnv(
      env,
      "PHASE4_AI_MAX_ATTEMPTS",
      3,
      options,
    ),
    maxInputChars: readPositiveIntegerEnv(
      env,
      "PHASE4_AI_MAX_INPUT_CHARS",
      120000,
      options,
    ),
    timeoutMs: readPositiveIntegerEnv(
      env,
      "PHASE4_AI_TIMEOUT_MS",
      120000,
      options,
    ),
    maxOutputBytes: readPositiveIntegerEnv(
      env,
      "PHASE4_AI_MAX_OUTPUT_BYTES",
      2 * 1024 * 1024,
      options,
    ),
  };
}

export function loadNotionSettingsFromEnv(
  env: NodeJS.ProcessEnv,
  options: EnvSettingsLoaderOptions = {},
): NotionRuntimeSettings {
  const settings: NotionRuntimeSettings = {
    enabled: readBooleanEnv(env, "NOTION_EXPORT_ENABLED", false, {
      onInvalid: () =>
        options.onInvalidBoolean?.("NOTION_EXPORT_ENABLED", false),
    }),
    apiKey: readOptionalStringEnv(env, "NOTION_API_KEY"),
    apiVersion:
      readOptionalStringEnv(env, "NOTION_API_VERSION") ??
      DEFAULT_NOTION_API_VERSION,
    baseUrl: readNotionBaseUrl(env, options),
    targetUrl: readOptionalStringEnv(env, "NOTION_TARGET_URL"),
    targetType: readNotionTargetType(env.NOTION_TARGET_TYPE),
    uploadMode: readNotionUploadMode(env.NOTION_UPLOAD_MODE),
    templateType: readNotionTemplateType(env.NOTION_TEMPLATE_TYPE),
    includeTranscript: readNotionIncludeTranscript(
      env.NOTION_INCLUDE_TRANSCRIPT,
    ),
    autoPollMs: readPositiveIntegerEnv(
      env,
      "NOTION_AUTO_POLL_MS",
      5000,
      options,
    ),
    leaseMs: readPositiveIntegerEnv(
      env,
      "NOTION_LEASE_MS",
      600000,
      options,
    ),
    maxAttempts: readPositiveIntegerEnv(
      env,
      "NOTION_MAX_ATTEMPTS",
      3,
      options,
    ),
    propertyNames: {
      title:
        readOptionalStringEnv(env, "NOTION_PROPERTY_TITLE") ??
        DEFAULT_NOTION_PROPERTY_NAMES.title,
      date:
        readOptionalStringEnv(env, "NOTION_PROPERTY_DATE") ??
        DEFAULT_NOTION_PROPERTY_NAMES.date,
      meetingTime:
        readOptionalStringEnv(env, "NOTION_PROPERTY_MEETING_TIME") ??
        DEFAULT_NOTION_PROPERTY_NAMES.meetingTime,
      channel:
        readOptionalStringEnv(env, "NOTION_PROPERTY_CHANNEL") ??
        DEFAULT_NOTION_PROPERTY_NAMES.channel,
      participants:
        readOptionalStringEnv(env, "NOTION_PROPERTY_PARTICIPANTS") ??
        DEFAULT_NOTION_PROPERTY_NAMES.participants,
      status:
        readOptionalStringEnv(env, "NOTION_PROPERTY_STATUS") ??
        DEFAULT_NOTION_PROPERTY_NAMES.status,
      sessionId:
        readOptionalStringEnv(env, "NOTION_PROPERTY_SESSION_ID") ??
        DEFAULT_NOTION_PROPERTY_NAMES.sessionId,
      draftId:
        readOptionalStringEnv(env, "NOTION_PROPERTY_DRAFT_ID") ??
        DEFAULT_NOTION_PROPERTY_NAMES.draftId,
      contentHash:
        readOptionalStringEnv(env, "NOTION_PROPERTY_CONTENT_HASH") ??
        DEFAULT_NOTION_PROPERTY_NAMES.contentHash,
      localStatus:
        readOptionalStringEnv(env, "NOTION_PROPERTY_LOCAL_STATUS") ??
        DEFAULT_NOTION_PROPERTY_NAMES.localStatus,
    },
  };

  const validation = validateNotionRuntimeSettings(settings);
  if (!validation.ok) {
    throw new Error(
      `${validation.userAction} 빠진 항목: ${validation.missingKeys.join(", ")}`,
    );
  }

  return settings;
}

function readSttProvider(value: string | undefined): SttProviderName {
  const provider = value?.trim() || "local-whisper";
  if (provider !== "local-whisper" && provider !== "openai") {
    throw new Error("PHASE3_STT_PROVIDER는 local-whisper 또는 openai여야 합니다.");
  }
  return provider;
}

function readNotionTargetType(value: string | undefined): NotionTargetType {
  const targetType = value?.trim() || "data_source";
  if (targetType !== "data_source") {
    throw new Error("NOTION_TARGET_TYPE은 data_source만 지원합니다.");
  }
  return targetType;
}

function readNotionUploadMode(value: string | undefined): NotionUploadMode {
  const uploadMode = value?.trim() || "manual";
  if (
    uploadMode !== "manual" &&
    uploadMode !== "automatic_after_ai_cleanup"
  ) {
    throw new Error(
      "NOTION_UPLOAD_MODE는 manual 또는 automatic_after_ai_cleanup이어야 합니다.",
    );
  }
  return uploadMode;
}

function readNotionTemplateType(value: string | undefined): NotionTemplateType {
  const templateType = value?.trim() || "app";
  if (templateType !== "app") {
    throw new Error("NOTION_TEMPLATE_TYPE은 MVP에서 app만 지원합니다.");
  }
  return templateType;
}

function readNotionIncludeTranscript(
  value: string | undefined,
): NotionIncludeTranscript {
  const includeTranscript = value?.trim() || "never";
  if (includeTranscript !== "never") {
    throw new Error("NOTION_INCLUDE_TRANSCRIPT는 MVP에서 never만 지원합니다.");
  }
  return includeTranscript;
}

function readNotionBaseUrl(
  env: NodeJS.ProcessEnv,
  options: EnvSettingsLoaderOptions,
): string {
  const baseUrl =
    readOptionalStringEnv(env, "NOTION_BASE_URL") ?? DEFAULT_NOTION_BASE_URL;
  if (baseUrl === DEFAULT_NOTION_BASE_URL) {
    return baseUrl;
  }

  if (options.allowTestNotionBaseUrl && isLocalTestUrl(baseUrl)) {
    return baseUrl.replace(/\/+$/, "");
  }

  throw new Error(
    "NOTION_BASE_URL은 https://api.notion.com이어야 합니다. 테스트에서는 allowTestNotionBaseUrl 옵션으로 local fake server URL만 허용합니다.",
  );
}

function isLocalTestUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      ["127.0.0.1", "localhost", "::1"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function readCommandArgs(value: string | undefined, fallback: string): string[] {
  const raw = value?.trim() || fallback;
  return splitCommandArgs(raw);
}

function readPositiveIntegerEnv(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  options: EnvSettingsLoaderOptions = {},
): number {
  try {
    return readPositiveNumberEnv(env, key, fallback, {
      integer: true,
      invalidMessage: `${key} 값은 1 이상의 정수여야 합니다.`,
    });
  } catch (error) {
    if (options.onInvalidPositiveInteger?.(key, fallback) === "fallback") {
      return fallback;
    }
    throw error;
  }
}

function readOptionalPositiveIntegerEnv(
  env: NodeJS.ProcessEnv,
  key: string,
  options: EnvSettingsLoaderOptions = {},
): number | null {
  if (!readOptionalStringEnv(env, key)) {
    return null;
  }
  try {
    return readPositiveNumberEnv(env, key, 1, {
      integer: true,
      invalidMessage: `${key} 값은 1 이상의 정수여야 합니다.`,
    });
  } catch (error) {
    if (options.onInvalidOptionalPositiveInteger?.(key) === "null") {
      return null;
    }
    throw error;
  }
}

export function splitCommandArgs(value: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === undefined) {
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
        continue;
      }
      current += char;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (quote) {
    throw new Error("PHASE3_LOCAL_WHISPER_ARGS에 닫히지 않은 따옴표가 있습니다.");
  }
  if (current.length > 0) {
    args.push(current);
  }
  return args;
}
