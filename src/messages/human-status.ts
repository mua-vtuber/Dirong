import { redactSensitiveText } from "../errors.js";
import { t, type LocaleKey } from "../i18n/catalog.js";
import type { DirongLocale } from "../settings/local-settings-store.js";

export type HumanStatusDetail = {
  label: string;
  value: string;
};

export type HumanStatusDisplay = {
  title: string;
  description: string;
  nextAction: string | null;
  details: HumanStatusDetail[];
};

export type HumanStatusDisplayInput = {
  titleKey: LocaleKey;
  descriptionKey: LocaleKey;
  nextActionKey?: LocaleKey | null;
  status?: string | null;
  message?: string | null;
  userAction?: string | null;
  technicalDetail?: string | null;
  messageKey?: string | null;
  userActionKey?: string | null;
  details?: readonly HumanStatusRawDetail[];
};

export type HumanStatusRawDetail = {
  label: string;
  value: unknown;
};

export function buildHumanStatusDisplay(
  locale: DirongLocale | undefined,
  input: HumanStatusDisplayInput,
): HumanStatusDisplay {
  return {
    title: t(locale, input.titleKey),
    description: t(locale, input.descriptionKey),
    nextAction: input.nextActionKey ? t(locale, input.nextActionKey) : null,
    details: buildHumanStatusDetails(input),
  };
}

export function formatHumanStatusDisplayForText(
  display: HumanStatusDisplay,
  labels: {
    title?: string;
    description?: string;
    nextAction?: string;
  } = {},
): string {
  const lines = [
    labels.title ? `${labels.title}: ${display.title}` : display.title,
    labels.description
      ? `${labels.description}: ${display.description}`
      : display.description,
  ];
  if (display.nextAction) {
    lines.push(
      labels.nextAction
        ? `${labels.nextAction}: ${display.nextAction}`
        : display.nextAction,
    );
  }
  return lines.join("\n");
}

function buildHumanStatusDetails(
  input: HumanStatusDisplayInput,
): HumanStatusDetail[] {
  const details: HumanStatusDetail[] = [];
  appendDetail(details, "status", input.status);
  appendDetail(details, "message", input.message);
  appendDetail(details, "userAction", input.userAction);
  appendDetail(details, "technicalDetail", input.technicalDetail);
  appendDetail(details, "messageKey", input.messageKey);
  appendDetail(details, "userActionKey", input.userActionKey);
  for (const detail of input.details ?? []) {
    appendDetail(details, detail.label, detail.value);
  }
  return details;
}

function appendDetail(
  details: HumanStatusDetail[],
  label: string,
  value: unknown,
): void {
  if (value === null || value === undefined || value === "") {
    return;
  }
  details.push({
    label,
    value: stringifyDetailValue(value),
  });
}

function stringifyDetailValue(value: unknown): string {
  if (typeof value === "string") {
    return redactSensitiveText(value);
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  try {
    return redactSensitiveText(JSON.stringify(value, null, 2));
  } catch {
    return redactSensitiveText(String(value));
  }
}
