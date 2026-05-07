import {
  parseCliArgs,
  readPositiveIntegerArg,
  readRequiredStringArg,
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
  "--dry-run": {
    kind: "boolean",
    apply: (options) => {
      options.dryRun = true;
    },
  },
  "--debug": {
    kind: "boolean",
    apply: (options) => {
      options.debug = true;
    },
  },
  "--include-fake-stt": {
    kind: "boolean",
    apply: (options) => {
      options.includeFakeStt = true;
    },
  },
  "--smoke-test": {
    kind: "boolean",
    apply: (options) => {
      options.smokeTest = true;
    },
  },
  "--no-backup": {
    kind: "boolean",
    apply: (options) => {
      options.backup = false;
    },
  },
  "--session": {
    kind: "value",
    read: (value) => readRequiredStringArg(value, "--session 값이 필요합니다."),
    apply: (options, value) => {
      options.sessionId = value;
    },
  },
  "--provider": {
    kind: "value",
    read: readProvider,
    apply: (options, value) => {
      options.provider = value;
    },
  },
  "--model": {
    kind: "value",
    read: (value) => readRequiredStringArg(value, "--model 값이 필요합니다."),
    apply: (options, value) => {
      options.model = value;
    },
  },
  "--lease-ms": {
    kind: "value",
    read: readPositiveIntegerArg,
    apply: (options, value) => {
      options.leaseMs = value;
    },
  },
  "--timeout-ms": {
    kind: "value",
    read: readPositiveIntegerArg,
    apply: (options, value) => {
      options.timeoutMs = value;
    },
  },
  "--max-input-chars": {
    kind: "value",
    read: readPositiveIntegerArg,
    apply: (options, value) => {
      options.maxInputChars = value;
    },
  },
  "--max-output-bytes": {
    kind: "value",
    read: readPositiveIntegerArg,
    apply: (options, value) => {
      options.maxOutputBytes = value;
    },
  },
};

function readProvider(value: string | undefined): Phase4AiCleanupProviderName {
  if (value === "fake" || value === "claude-cli") {
    return value;
  }
  throw new Error("--provider 값은 fake 또는 claude-cli 중 하나여야 합니다.");
}
