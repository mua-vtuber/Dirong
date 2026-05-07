export type CliBooleanArg<TOptions> = {
  kind: "boolean";
  apply: (options: TOptions) => void;
};

export type CliValueArg<TOptions, TValue = any> = {
  kind: "value";
  read: (value: string | undefined, flag: string) => TValue;
  apply: (options: TOptions, value: TValue) => void;
};

export type CliArgSpec<TOptions> =
  | CliBooleanArg<TOptions>
  | CliValueArg<TOptions>;

export function parseCliArgs<TOptions>(
  args: string[],
  options: TOptions,
  spec: Record<string, CliArgSpec<TOptions>>,
  unknownFlagMessage: (flag: string) => string,
): TOptions {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    const entry = spec[arg];
    if (!entry) {
      throw new Error(unknownFlagMessage(arg));
    }

    if (entry.kind === "boolean") {
      entry.apply(options);
      continue;
    }

    const value = entry.read(args[index + 1], arg);
    entry.apply(options, value);
    index += 1;
  }

  return options;
}

export function readRequiredStringArg(
  value: string | undefined,
  message: string,
): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(message);
  }
  return trimmed;
}

export function readPositiveIntegerArg(
  value: string | undefined,
  flag: string,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} 값은 1 이상의 정수여야 합니다.`);
  }
  return parsed;
}
