import {
  booleanOptionArg,
  parseCliArgs,
  positiveIntegerOptionArg,
  requiredStringOptionArg,
  valueArg,
  type CliArgSpec,
} from "../cli/arg-parser.js";
import { formatLocaleText, t } from "../i18n/catalog.js";
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
  return parseCliArgs(
    args,
    {
      limit: 1,
      sessionId: null,
      dryRun: false,
      backup: true,
      provider: null,
      model: null,
      leaseMs: null,
      debug: false,
    },
    PHASE3_ARG_SPEC,
    (flag) => formatLocaleText("ko", "runtimeCli.phaseCli.phase3UnknownOption", { flag }),
  );
}

const PHASE3_ARG_SPEC: Record<string, CliArgSpec<Phase3SttCliOptions>> = {
  "--dry-run": booleanOptionArg("dryRun", true),
  "--debug": booleanOptionArg("debug", true),
  "--no-backup": booleanOptionArg("backup", false),
  "--limit": positiveIntegerOptionArg("limit"),
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
};

function readProvider(value: string | undefined): SttProviderName {
  const provider = value?.trim();
  if (provider !== "local-whisper" && provider !== "openai") {
    throw new Error(t("ko", "runtimeCli.phaseCli.sttProviderInvalid"));
  }
  return provider;
}
