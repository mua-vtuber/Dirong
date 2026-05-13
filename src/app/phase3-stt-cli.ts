import {
  booleanOptionArg,
  parseCliArgs,
  positiveIntegerOptionArg,
  requiredStringOptionArg,
  valueArg,
  type CliArgSpec,
} from "../cli/arg-parser.js";
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
    (flag) => `알 수 없는 Phase 3 STT 옵션입니다: ${flag}`,
  );
}

const PHASE3_ARG_SPEC: Record<string, CliArgSpec<Phase3SttCliOptions>> = {
  "--dry-run": booleanOptionArg("dryRun", true),
  "--debug": booleanOptionArg("debug", true),
  "--no-backup": booleanOptionArg("backup", false),
  "--limit": positiveIntegerOptionArg("limit"),
  "--session": requiredStringOptionArg("--session 값이 필요합니다.", "sessionId"),
  "--provider": valueArg(readProvider, (options, value) => {
    options.provider = value;
  }),
  "--model": requiredStringOptionArg("--model 값이 필요합니다.", "model"),
  "--lease-ms": positiveIntegerOptionArg("leaseMs"),
};

function readProvider(value: string | undefined): SttProviderName {
  const provider = value?.trim();
  if (provider !== "local-whisper" && provider !== "openai") {
    throw new Error("--provider는 local-whisper 또는 openai여야 합니다.");
  }
  return provider;
}
