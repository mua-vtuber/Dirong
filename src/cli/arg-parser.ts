import { formatLocaleText } from "../i18n/catalog.js";

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

type KeysAccepting<TOptions, TValue> = {
  [Key in keyof TOptions]-?: TValue extends TOptions[Key] ? Key : never;
}[keyof TOptions];

export function booleanArg<TOptions>(
  apply: (options: TOptions) => void,
): CliBooleanArg<TOptions> {
  return { kind: "boolean", apply };
}

export function valueArg<TOptions, TValue>(
  read: (value: string | undefined, flag: string) => TValue,
  apply: (options: TOptions, value: TValue) => void,
): CliValueArg<TOptions, TValue> {
  return { kind: "value", read, apply };
}

export function positiveIntegerArg<TOptions>(
  apply: (options: TOptions, value: number) => void,
): CliValueArg<TOptions, number> {
  return valueArg(readPositiveIntegerArg, apply);
}

export function requiredStringArg<TOptions>(
  message: string,
  apply: (options: TOptions, value: string) => void,
): CliValueArg<TOptions, string> {
  return valueArg(
    (value) => readRequiredStringArg(value, message),
    apply,
  );
}

export function booleanOptionArg<
  TOptions,
  TKey extends KeysAccepting<TOptions, boolean>,
>(key: TKey, value: boolean): CliBooleanArg<TOptions> {
  return booleanArg((options) => {
    options[key] = value as TOptions[TKey];
  });
}

export function positiveIntegerOptionArg<
  TOptions,
  TKey extends KeysAccepting<TOptions, number>,
>(key: TKey): CliValueArg<TOptions, number> {
  return positiveIntegerArg((options, value) => {
    options[key] = value as TOptions[TKey];
  });
}

export function requiredStringOptionArg<
  TOptions,
  TKey extends KeysAccepting<TOptions, string>,
>(message: string, key: TKey): CliValueArg<TOptions, string> {
  return requiredStringArg(message, (options, value) => {
    options[key] = value as TOptions[TKey];
  });
}

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
    throw new Error(formatLocaleText("ko", "runtimeCli.argParser.positiveIntegerRequired", {
      flag,
    }));
  }
  return parsed;
}
