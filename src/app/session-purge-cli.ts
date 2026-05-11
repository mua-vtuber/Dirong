import {
  parseCliArgs,
  readRequiredStringArg,
  type CliArgSpec,
} from "../cli/arg-parser.js";
import type { SessionPurgeSelector } from "../storage/session-purge.js";

export type SessionPurgeCliOptions = {
  operation: "purge-sessions" | "expired-text-artifacts";
  selector: SessionPurgeSelector;
  dryRun: boolean;
  backup: boolean;
  debug: boolean;
};

type MutableSessionPurgeCliOptions = {
  sessionIds: string[];
  missingAudio: boolean;
  all: boolean;
  expiredTextArtifacts: boolean;
  confirm: boolean;
  explicitDryRun: boolean;
  backup: boolean;
  debug: boolean;
};

export function parseSessionPurgeArgs(args: string[]): SessionPurgeCliOptions {
  const options = parseCliArgs(
    args,
    {
      sessionIds: [],
      missingAudio: false,
      all: false,
      expiredTextArtifacts: false,
      confirm: false,
      explicitDryRun: false,
      backup: true,
      debug: false,
    },
    SESSION_PURGE_ARG_SPEC,
    (flag) => `알 수 없는 session purge 옵션입니다: ${flag}`,
  );

  const selectorCount =
    (options.sessionIds.length > 0 ? 1 : 0) +
    (options.missingAudio ? 1 : 0) +
    (options.all ? 1 : 0) +
    (options.expiredTextArtifacts ? 1 : 0);
  if (selectorCount !== 1) {
    throw new Error(
      "--session, --missing-audio, --all, --expired-text-artifacts 중 정확히 하나가 필요합니다.",
    );
  }

  const selector: SessionPurgeSelector = options.sessionIds.length > 0
    ? { kind: "sessions", sessionIds: options.sessionIds }
    : options.missingAudio
      ? { kind: "missing-audio" }
      : { kind: "all" };

  return {
    operation: options.expiredTextArtifacts
      ? "expired-text-artifacts"
      : "purge-sessions",
    selector,
    dryRun: options.explicitDryRun || !options.confirm,
    backup: options.backup,
    debug: options.debug,
  };
}

const SESSION_PURGE_ARG_SPEC: Record<
  string,
  CliArgSpec<MutableSessionPurgeCliOptions>
> = {
  "--session": {
    kind: "value",
    read: (value) => readRequiredStringArg(value, "--session 값이 필요합니다."),
    apply: (options, value) => {
      options.sessionIds.push(value);
    },
  },
  "--missing-audio": {
    kind: "boolean",
    apply: (options) => {
      options.missingAudio = true;
    },
  },
  "--all": {
    kind: "boolean",
    apply: (options) => {
      options.all = true;
    },
  },
  "--expired-text-artifacts": {
    kind: "boolean",
    apply: (options) => {
      options.expiredTextArtifacts = true;
    },
  },
  "--confirm": {
    kind: "boolean",
    apply: (options) => {
      options.confirm = true;
    },
  },
  "--dry-run": {
    kind: "boolean",
    apply: (options) => {
      options.explicitDryRun = true;
    },
  },
  "--no-backup": {
    kind: "boolean",
    apply: (options) => {
      options.backup = false;
    },
  },
  "--debug": {
    kind: "boolean",
    apply: (options) => {
      options.debug = true;
    },
  },
};
