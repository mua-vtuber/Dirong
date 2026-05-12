import process from "node:process";
import { safeErrorInfo } from "../errors.js";
import { resolveAppLocale } from "../i18n/app-locale.js";
import {
  formatDebugHint,
  formatUserFacingError,
} from "../messages/user-messages.js";
import {
  DEFAULT_DIRONG_LOCALE,
  LocalSettingsStore,
  type DirongLocale,
} from "../settings/local-settings-store.js";
import {
  getDirongUserDataPaths,
  resolveDirongUserDataPath,
} from "../settings/dirong-user-data.js";

export function isDebugMode(
  args: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const envValue = env.DIRONG_DEBUG?.trim().toLowerCase();
  return (
    args.includes("--debug") ||
    envValue === "1" ||
    envValue === "true" ||
    envValue === "yes" ||
    envValue === "on"
  );
}

export function printCliError(
  error: unknown,
  options?: { prefix?: string; args?: readonly string[] },
): void {
  const locale = resolveCliLocale();
  const summary = formatUserFacingError(error, locale);
  console.error(options?.prefix ? `${options.prefix}: ${summary}` : summary);

  if (isDebugMode(options?.args)) {
    console.error("");
    console.error("debug detail:");
    console.error(JSON.stringify(safeErrorInfo(error), null, 2));
    return;
  }

  console.error("");
  console.error(formatDebugHint(locale));
}

function resolveCliLocale(): DirongLocale {
  try {
    const paths = getDirongUserDataPaths(resolveDirongUserDataPath());
    return resolveAppLocale({
      settingsStore: new LocalSettingsStore(paths.settingsFile),
    });
  } catch {
    return DEFAULT_DIRONG_LOCALE;
  }
}
