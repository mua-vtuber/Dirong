import {
  booleanOptionArg,
  parseCliArgs,
  requiredStringOptionArg,
  type CliArgSpec,
} from "../cli/arg-parser.js";
import { formatLocaleText, t } from "../i18n/catalog.js";

export type Phase5NotionUploadCliOptions = {
  sessionId: string | null;
  draftId: string | null;
  dryRun: boolean;
  force: boolean;
  debug: boolean;
};

export function parsePhase5NotionUploadArgs(
  args: string[],
): Phase5NotionUploadCliOptions {
  const options = parseCliArgs(
    args,
    {
      sessionId: null,
      draftId: null,
      dryRun: false,
      force: false,
      debug: false,
    },
    PHASE5_ARG_SPEC,
    (flag) => formatLocaleText("ko", "runtimeCli.phaseCli.phase5UnknownOption", { flag }),
  );

  if ((options.sessionId ? 1 : 0) + (options.draftId ? 1 : 0) !== 1) {
    throw new Error(t("ko", "runtimeCli.phaseCli.phase5SelectorRequired"));
  }

  return options;
}

const PHASE5_ARG_SPEC: Record<
  string,
  CliArgSpec<Phase5NotionUploadCliOptions>
> = {
  "--dry-run": booleanOptionArg("dryRun", true),
  "--force": booleanOptionArg("force", true),
  "--debug": booleanOptionArg("debug", true),
  "--session": requiredStringOptionArg(
    t("ko", "runtimeCli.phaseCli.sessionValueRequired"),
    "sessionId",
  ),
  "--draft": requiredStringOptionArg(
    t("ko", "runtimeCli.phaseCli.draftValueRequired"),
    "draftId",
  ),
};
