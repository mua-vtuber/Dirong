import type { SttProviderName } from "../settings/app-settings.js";

export type Phase3SttCliOptions = {
  limit: number;
  sessionId: string | null;
  dryRun: boolean;
  backup: boolean;
  provider: SttProviderName | null;
  model: string | null;
  leaseMs: number | null;
  debug: boolean;
};

export function parsePhase3SttArgs(args: string[]): Phase3SttCliOptions {
  const options: Phase3SttCliOptions = {
    limit: 1,
    sessionId: null,
    dryRun: false,
    backup: true,
    provider: null,
    model: null,
    leaseMs: null,
    debug: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--debug") {
      options.debug = true;
      continue;
    }
    if (arg === "--no-backup") {
      options.backup = false;
      continue;
    }
    if (arg === "--limit") {
      options.limit = readPositiveNumber(args[index + 1], "--limit");
      index += 1;
      continue;
    }
    if (arg === "--session") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error("--session 값이 필요합니다.");
      }
      options.sessionId = value;
      index += 1;
      continue;
    }
    if (arg === "--provider") {
      const value = args[index + 1]?.trim();
      if (value !== "local-whisper" && value !== "openai") {
        throw new Error("--provider는 local-whisper 또는 openai여야 합니다.");
      }
      options.provider = value;
      index += 1;
      continue;
    }
    if (arg === "--model") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error("--model 값이 필요합니다.");
      }
      options.model = value;
      index += 1;
      continue;
    }
    if (arg === "--lease-ms") {
      options.leaseMs = readPositiveNumber(args[index + 1], "--lease-ms");
      index += 1;
      continue;
    }

    throw new Error(`알 수 없는 Phase 3 STT 옵션입니다: ${arg ?? ""}`);
  }

  return options;
}

function readPositiveNumber(value: string | undefined, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} 값은 1 이상의 정수여야 합니다.`);
  }
  return parsed;
}
