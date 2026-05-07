import {
  parseCliArgs,
  readPositiveIntegerArg,
  readRequiredStringArg,
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
  "--no-backup": {
    kind: "boolean",
    apply: (options) => {
      options.backup = false;
    },
  },
  "--limit": {
    kind: "value",
    read: readPositiveIntegerArg,
    apply: (options, value) => {
      options.limit = value;
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
};

function readProvider(value: string | undefined): SttProviderName {
  const provider = value?.trim();
  if (provider !== "local-whisper" && provider !== "openai") {
    throw new Error("--provider는 local-whisper 또는 openai여야 합니다.");
  }
  return provider;
}
