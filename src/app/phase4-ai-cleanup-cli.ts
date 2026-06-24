import {
  booleanOptionArg,
  parseCliArgs,
  positiveIntegerOptionArg,
  requiredStringOptionArg,
  valueArg,
  type CliArgSpec,
} from "../cli/arg-parser.js";
import { formatLocaleText, t } from "../i18n/catalog.js";

export type Phase4AiCleanupProviderName =
  | "settings"
  | "fake"
  | "claude-cli"
  | "claude-api"
  | "codex-cli"
  | "gemini-cli";

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
      provider: "settings",
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
    (flag) => formatLocaleText("ko", "runtimeCli.phaseCli.phase4UnknownOption", { flag }),
  );

  if (!options.sessionId) {
    throw new Error(t("ko", "runtimeCli.phaseCli.phase4SessionRequired"));
  }
  if (options.smokeTest && options.provider !== "fake") {
    throw new Error(t("ko", "runtimeCli.phaseCli.smokeTestRequiresFake"));
  }
  if (options.includeFakeStt && !options.dryRun && !options.smokeTest) {
    throw new Error(t("ko", "runtimeCli.phaseCli.includeFakeSttRequiresDryRun"));
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
  "--session": requiredStringOptionArg(
    t("ko", "runtimeCli.phaseCli.sessionValueRequired"),
    "sessionId",
  ),
  "--provider": valueArg(readProvider, (options, value) => {
    options.provider = value;
  }),
  "--model": requiredStringOptionArg(
    t("ko", "runtimeCli.phaseCli.modelValueRequired"),
    "model",
  ),
  "--lease-ms": positiveIntegerOptionArg("leaseMs"),
  "--timeout-ms": positiveIntegerOptionArg("timeoutMs"),
  "--max-input-chars": positiveIntegerOptionArg("maxInputChars"),
  "--max-output-bytes": positiveIntegerOptionArg("maxOutputBytes"),
};

function readProvider(value: string | undefined): Phase4AiCleanupProviderName {
  if (
    value === "fake" ||
    value === "settings" ||
    value === "claude-cli" ||
    value === "claude-api" ||
    value === "codex-cli" ||
    value === "gemini-cli"
  ) {
    return value;
  }
  throw new Error(t("ko", "runtimeCli.phaseCli.aiProviderInvalid"));
}
