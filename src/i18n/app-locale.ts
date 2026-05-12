import {
  DEFAULT_DIRONG_LOCALE,
  isDirongLocale,
  type DirongLocale,
} from "../settings/local-settings-store.js";

export type AppLocaleResolver = () => DirongLocale;

export type AppLocaleSettingsReader = {
  read(): {
    app?: {
      locale?: unknown;
    };
  };
};

export type AppLocaleResolverInput = {
  locale?: unknown;
  getLocale?: () => unknown;
  settingsStore?: AppLocaleSettingsReader | null;
};

export function resolveAppLocale(
  input: AppLocaleResolverInput = {},
): DirongLocale {
  const explicitLocale = readLocale(input.locale);
  if (explicitLocale) {
    return explicitLocale;
  }

  const providedLocale = readSafely(input.getLocale);
  if (providedLocale) {
    return providedLocale;
  }

  const settingsLocale = readSettingsLocale(input.settingsStore);
  if (settingsLocale) {
    return settingsLocale;
  }

  return DEFAULT_DIRONG_LOCALE;
}

export function createAppLocaleResolver(
  input: AppLocaleResolverInput = {},
): AppLocaleResolver {
  return () => resolveAppLocale(input);
}

function readSafely(reader: (() => unknown) | undefined): DirongLocale | null {
  if (!reader) {
    return null;
  }
  try {
    return readLocale(reader());
  } catch {
    return null;
  }
}

function readSettingsLocale(
  settingsStore: AppLocaleSettingsReader | null | undefined,
): DirongLocale | null {
  if (!settingsStore) {
    return null;
  }
  try {
    return readLocale(settingsStore.read().app?.locale);
  } catch {
    return null;
  }
}

function readLocale(value: unknown): DirongLocale | null {
  return isDirongLocale(value) ? value : null;
}
