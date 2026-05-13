import {
  booleanOptionArg,
  parseCliArgs,
  positiveIntegerOptionArg,
  requiredStringOptionArg,
  valueArg,
  type CliArgSpec,
} from "../cli/arg-parser.js";

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
  const options = parseCliArgs(
    args,
    {
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
    },
    PHASE4_ARG_SPEC,
    (flag) => `알 수 없는 Phase 4 AI cleanup 옵션입니다: ${flag}`,
  );

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

const PHASE4_ARG_SPEC: Record<
  string,
  CliArgSpec<{
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
  }>
> = {
  "--dry-run": booleanOptionArg("dryRun", true),
  "--debug": booleanOptionArg("debug", true),
  "--include-fake-stt": booleanOptionArg("includeFakeStt", true),
  "--smoke-test": booleanOptionArg("smokeTest", true),
  "--no-backup": booleanOptionArg("backup", false),
  "--session": requiredStringOptionArg("--session 값이 필요합니다.", "sessionId"),
  "--provider": valueArg(readProvider, (options, value) => {
    options.provider = value;
  }),
  "--model": requiredStringOptionArg("--model 값이 필요합니다.", "model"),
  "--lease-ms": positiveIntegerOptionArg("leaseMs"),
  "--timeout-ms": positiveIntegerOptionArg("timeoutMs"),
  "--max-input-chars": positiveIntegerOptionArg("maxInputChars"),
  "--max-output-bytes": positiveIntegerOptionArg("maxOutputBytes"),
};

function readProvider(value: string | undefined): Phase4AiCleanupProviderName {
  if (value === "fake" || value === "claude-cli") {
    return value;
  }
  throw new Error("--provider 값은 fake 또는 claude-cli 중 하나여야 합니다.");
}
