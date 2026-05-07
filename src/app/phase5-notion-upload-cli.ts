import {
  parseCliArgs,
  readRequiredStringArg,
  type CliArgSpec,
} from "../cli/arg-parser.js";

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
    (flag) => `알 수 없는 Phase 5 Notion upload 옵션입니다: ${flag}`,
  );

  if ((options.sessionId ? 1 : 0) + (options.draftId ? 1 : 0) !== 1) {
    throw new Error("--session 또는 --draft 중 정확히 하나가 필요합니다.");
  }

  return options;
}

const PHASE5_ARG_SPEC: Record<
  string,
  CliArgSpec<Phase5NotionUploadCliOptions>
> = {
  "--dry-run": {
    kind: "boolean",
    apply: (options) => {
      options.dryRun = true;
    },
  },
  "--force": {
    kind: "boolean",
    apply: (options) => {
      options.force = true;
    },
  },
  "--debug": {
    kind: "boolean",
    apply: (options) => {
      options.debug = true;
    },
  },
  "--session": {
    kind: "value",
    read: (value) => readRequiredStringArg(value, "--session 값이 필요합니다."),
    apply: (options, value) => {
      options.sessionId = value;
    },
  },
  "--draft": {
    kind: "value",
    read: (value) => readRequiredStringArg(value, "--draft 값이 필요합니다."),
    apply: (options, value) => {
      options.draftId = value;
    },
  },
};
