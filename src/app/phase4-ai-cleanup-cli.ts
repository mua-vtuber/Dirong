export type Phase4AiCleanupProviderName = "fake" | "claude-cli";

export type Phase4AiCleanupCliOptions = {
  sessionId: string;
  dryRun: boolean;
  backup: boolean;
  provider: Phase4AiCleanupProviderName;
  model: string | null;
  leaseMs: number | null;
  timeoutMs: number | null;
  maxInputChars: number | null;
  maxOutputBytes: number | null;
  includeFakeStt: boolean;
  smokeTest: boolean;
  debug: boolean;
};

export function parsePhase4AiCleanupArgs(
  args: string[],
): Phase4AiCleanupCliOptions {
  const options: {
    sessionId: string | null;
    dryRun: boolean;
    backup: boolean;
    provider: Phase4AiCleanupProviderName;
    model: string | null;
    leaseMs: number | null;
    timeoutMs: number | null;
    maxInputChars: number | null;
    maxOutputBytes: number | null;
    includeFakeStt: boolean;
    smokeTest: boolean;
    debug: boolean;
  } = {
    sessionId: null,
    dryRun: false,
    backup: true,
    provider: "claude-cli",
    model: null,
    leaseMs: null,
    timeoutMs: null,
    maxInputChars: null,
    maxOutputBytes: null,
    includeFakeStt: false,
    smokeTest: false,
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
    if (arg === "--include-fake-stt") {
      options.includeFakeStt = true;
      continue;
    }
    if (arg === "--smoke-test") {
      options.smokeTest = true;
      continue;
    }
    if (arg === "--no-backup") {
      options.backup = false;
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
      options.provider = readProvider(args[index + 1]);
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
    if (arg === "--timeout-ms") {
      options.timeoutMs = readPositiveNumber(args[index + 1], "--timeout-ms");
      index += 1;
      continue;
    }
    if (arg === "--max-input-chars") {
      options.maxInputChars = readPositiveNumber(
        args[index + 1],
        "--max-input-chars",
      );
      index += 1;
      continue;
    }
    if (arg === "--max-output-bytes") {
      options.maxOutputBytes = readPositiveNumber(
        args[index + 1],
        "--max-output-bytes",
      );
      index += 1;
      continue;
    }

    throw new Error(`알 수 없는 Phase 4 AI cleanup 옵션입니다: ${arg ?? ""}`);
  }

  if (!options.sessionId) {
    throw new Error("--session <session-id> 값이 필요합니다.");
  }
  if (options.smokeTest && options.provider !== "fake") {
    throw new Error(
      "--smoke-test는 --provider fake와 함께 사용하는 명시적 smoke test 전용 옵션입니다.",
    );
  }
  if (options.includeFakeStt && !options.dryRun && !options.smokeTest) {
    throw new Error(
      "--include-fake-stt는 dry-run 진단 또는 --provider fake --smoke-test에서만 사용할 수 있습니다.",
    );
  }

  return {
    sessionId: options.sessionId,
    dryRun: options.dryRun,
    backup: options.backup,
    provider: options.provider,
    model: options.model,
    leaseMs: options.leaseMs,
    timeoutMs: options.timeoutMs,
    maxInputChars: options.maxInputChars,
    maxOutputBytes: options.maxOutputBytes,
    includeFakeStt: options.includeFakeStt,
    smokeTest: options.smokeTest,
    debug: options.debug,
  };
}

function readProvider(value: string | undefined): Phase4AiCleanupProviderName {
  if (value === "fake" || value === "claude-cli") {
    return value;
  }
  throw new Error("--provider 값은 fake 또는 claude-cli 중 하나여야 합니다.");
}

function readPositiveNumber(value: string | undefined, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} 값은 1 이상의 정수여야 합니다.`);
  }
  return parsed;
}
