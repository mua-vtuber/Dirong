import path from "node:path";
import dotenv from "dotenv";
import type { AppSettings, SttProviderName, SttSettings } from "./app-settings.js";

export function loadAppSettingsFromEnv(): AppSettings {
  dotenv.config({ path: path.resolve(process.cwd(), ".env"), quiet: true });
  return { stt: loadSttSettingsFromEnv(process.env) };
}

export function loadSttSettingsFromEnv(
  env: NodeJS.ProcessEnv,
): SttSettings {
  const provider = readSttProvider(env.PHASE3_STT_PROVIDER);
  const language = env.PHASE3_STT_LANGUAGE?.trim() || "ko";
  const timeoutMs = readNonZeroNumber(env.PHASE3_STT_TIMEOUT_MS, 120000);

  if (provider === "openai") {
    return {
      provider,
      language,
      timeoutMs,
      openai: {
        apiKey: env.OPENAI_API_KEY?.trim() ?? "",
        model: env.PHASE3_STT_MODEL?.trim() || "gpt-4o-mini-transcribe",
      },
    };
  }

  return {
    provider,
    language,
    timeoutMs,
    localWhisper: {
      command: env.PHASE3_LOCAL_WHISPER_COMMAND?.trim() || "python",
      args: readCommandArgs(
        env.PHASE3_LOCAL_WHISPER_ARGS,
        "scripts/local-whisper-json.py",
      ),
      model: env.PHASE3_LOCAL_WHISPER_MODEL?.trim() || "small",
      device: env.PHASE3_LOCAL_WHISPER_DEVICE?.trim() || "cpu",
      computeType: env.PHASE3_LOCAL_WHISPER_COMPUTE_TYPE?.trim() || "int8",
    },
  };
}

function readSttProvider(value: string | undefined): SttProviderName {
  const provider = value?.trim() || "local-whisper";
  if (provider !== "local-whisper" && provider !== "openai") {
    throw new Error("PHASE3_STT_PROVIDER는 local-whisper 또는 openai여야 합니다.");
  }
  return provider;
}

function readNonZeroNumber(value: string | undefined, fallback: number): number {
  const raw = value?.trim();
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("PHASE3_STT_TIMEOUT_MS는 1 이상의 숫자여야 합니다.");
  }
  return parsed;
}

function readCommandArgs(value: string | undefined, fallback: string): string[] {
  const raw = value?.trim() || fallback;
  return splitCommandArgs(raw);
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
