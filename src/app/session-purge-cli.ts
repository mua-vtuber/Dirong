import {
  booleanOptionArg,
  parseCliArgs,
  requiredStringArg,
  type CliArgSpec,
} from "../cli/arg-parser.js";
import { formatLocaleText, t } from "../i18n/catalog.js";
import type { DirongLocale } from "../settings/local-settings-store.js";
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

export function parseSessionPurgeArgs(
  args: string[],
  locale?: DirongLocale,
): SessionPurgeCliOptions {
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
    sessionPurgeArgSpec(locale),
    (flag) =>
      formatLocaleText(locale, "sessionPurge.cli.unknownOption", { flag }),
  );

  const selectorCount =
    (options.sessionIds.length > 0 ? 1 : 0) +
    (options.missingAudio ? 1 : 0) +
    (options.all ? 1 : 0) +
    (options.expiredTextArtifacts ? 1 : 0);
  if (selectorCount !== 1) {
    throw new Error(t(locale, "sessionPurge.cli.selectorRequired"));
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

function sessionPurgeArgSpec(
  locale?: DirongLocale,
): Record<string, CliArgSpec<MutableSessionPurgeCliOptions>> {
  return {
    "--session": requiredStringArg(
      t(locale, "sessionPurge.cli.sessionValueRequired"),
      (options, value) => {
        options.sessionIds.push(value);
      },
    ),
    "--missing-audio": booleanOptionArg("missingAudio", true),
    "--all": booleanOptionArg("all", true),
    "--expired-text-artifacts": booleanOptionArg("expiredTextArtifacts", true),
    "--confirm": booleanOptionArg("confirm", true),
    "--dry-run": booleanOptionArg("explicitDryRun", true),
    "--no-backup": booleanOptionArg("backup", false),
    "--debug": booleanOptionArg("debug", true),
  };
}
