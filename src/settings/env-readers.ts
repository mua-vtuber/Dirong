export type EnvReaderOptions = {
  integer?: boolean;
  invalidMessage?: string;
};

export function readOptionalStringEnv(
  env: NodeJS.ProcessEnv,
  key: string,
): string | null {
  const value = env[key]?.trim();
  return value ? value : null;
}

export function readBooleanEnv(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: boolean,
  options: { onInvalid?: (raw: string) => void } = {},
): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (!raw) {
    return fallback;
  }
  if (["1", "true", "yes", "y", "on"].includes(raw)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(raw)) {
    return false;
  }
  options.onInvalid?.(raw);
  return fallback;
}

export function readPositiveNumberEnv(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  options: EnvReaderOptions = {},
): number {
  const raw = env[key]?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!isValidNumber(parsed, { ...options, min: 0, exclusiveMin: true })) {
    throw new Error(
      options.invalidMessage ?? `${key} 값은 1 이상의 숫자여야 합니다.`,
    );
  }
  return parsed;
}

export function readNonNegativeNumberEnv(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  options: EnvReaderOptions = {},
): number {
  const raw = env[key]?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!isValidNumber(parsed, { ...options, min: 0, exclusiveMin: false })) {
    throw new Error(
      options.invalidMessage ?? `${key} 값은 0 이상의 숫자여야 합니다.`,
    );
  }
  return parsed;
}

function isValidNumber(
  value: number,
  options: EnvReaderOptions & { min: number; exclusiveMin: boolean },
): boolean {
  if (!Number.isFinite(value)) {
    return false;
  }
  if (options.integer && !Number.isInteger(value)) {
    return false;
  }
  return options.exclusiveMin ? value > options.min : value >= options.min;
}
