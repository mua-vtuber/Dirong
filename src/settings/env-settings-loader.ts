import path from "node:path";
import dotenv from "dotenv";
import type {
  AiCleanupRuntimeSettings,
  AppSettings,
  SttProviderName,
  SttSettings,
} from "./app-settings.js";
import {
  readBooleanEnv,
  readOptionalStringEnv,
  readPositiveNumberEnv,
} from "./env-readers.js";

export type EnvSettingsLoaderOptions = {
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

function readSttProvider(value: string | undefined): SttProviderName {
  const provider = value?.trim() || "local-whisper";
  if (provider !== "local-whisper" && provider !== "openai") {
    throw new Error("PHASE3_STT_PROVIDER는 local-whisper 또는 openai여야 합니다.");
  }
  return provider;
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
