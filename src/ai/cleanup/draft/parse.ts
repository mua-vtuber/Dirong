import { MEETING_NOTES_DRAFT_SCHEMA_VERSION } from "./schema.js";

export class DraftParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftParseError";
  }
}


export function parseMeetingNotesDraftFromRawText(rawText: string): unknown {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new DraftParseError("provider output is empty");
  }

  const parsed = extractJsonValueFromText(trimmed);
  if (parsed.ok) {
    return unwrapProviderEnvelope(parsed.value, 0);
  }

  throw new DraftParseError("provider output did not contain valid JSON");
}

function unwrapProviderEnvelope(value: unknown, depth: number): unknown {
  if (depth > 4) {
    return value;
  }

  const record = isRecord(value) ? value : null;
  if (!record) {
    return value;
  }

  if (record.schemaVersion === MEETING_NOTES_DRAFT_SCHEMA_VERSION) {
    return record;
  }

  const structuredOutput = unwrapEnvelopeEntry(record.structured_output, depth);
  if (structuredOutput.ok) {
    return structuredOutput.value;
  }

  for (const key of ["result", "response", "text", "content", "message"]) {
    const unwrapped = unwrapEnvelopeEntry(record[key], depth);
    if (unwrapped.ok) {
      return unwrapped.value;
    }
  }

  const content = record.content;
  if (Array.isArray(content)) {
    const text = content
      .map((item) =>
        isRecord(item) && typeof item.text === "string" ? item.text : "",
      )
      .join("\n")
      .trim();
    if (text.length > 0) {
      const parsed = extractJsonValueFromText(text);
      if (parsed.ok) {
        return unwrapProviderEnvelope(parsed.value, depth + 1);
      }
    }
  }

  return value;
}

function unwrapEnvelopeEntry(
  entry: unknown,
  depth: number,
): { ok: true; value: unknown } | { ok: false } {
  if (isRecord(entry)) {
    return { ok: true, value: unwrapProviderEnvelope(entry, depth + 1) };
  }

  if (typeof entry !== "string") {
    return { ok: false };
  }

  const parsed = extractJsonValueFromText(entry);
  if (!parsed.ok) {
    return { ok: false };
  }

  return { ok: true, value: unwrapProviderEnvelope(parsed.value, depth + 1) };
}

function extractJsonValueFromText(
  text: string,
): { ok: true; value: unknown } | { ok: false } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false };
  }

  const direct = tryParseJson(trimmed);
  if (direct.ok) {
    return direct;
  }

  for (const fenced of extractJsonFences(trimmed).reverse()) {
    const parsed = tryParseJson(fenced);
    if (parsed.ok) {
      return parsed;
    }
  }

  const trailingLine = extractTrailingJsonLine(trimmed);
  if (trailingLine) {
    const parsed = tryParseJson(trailingLine);
    if (parsed.ok) {
      return parsed;
    }
  }

  const lastObject = extractLastJsonObjectBlock(trimmed);
  if (lastObject) {
    const parsed = tryParseJson(lastObject);
    if (parsed.ok) {
      return parsed;
    }
  }

  return { ok: false };
}

function extractJsonFences(text: string): string[] {
  const fences: string[] = [];
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const body = match[1]?.trim();
    if (body) {
      fences.push(body);
    }
  }
  return fences;
}

function extractTrailingJsonLine(text: string): string | null {
  const lines = text.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim() ?? "";
    if (!line) {
      continue;
    }
    if (
      (line.startsWith("{") && line.endsWith("}")) ||
      (line.startsWith("[") && line.endsWith("]"))
    ) {
      return line;
    }
  }
  return null;
}

function extractLastJsonObjectBlock(text: string): string | null {
  let depth = 0;
  let inString = false;
  let stringChar = "";
  let escaped = false;
  let currentStart = -1;
  let candidateStart = -1;
  let candidateEnd = -1;

  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === stringChar) {
        inString = false;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      inString = true;
      stringChar = char;
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        currentStart = index;
      }
      depth += 1;
      continue;
    }

    if (char === "}") {
      if (depth === 0) {
        continue;
      }
      depth -= 1;
      if (depth === 0 && currentStart >= 0) {
        candidateStart = currentStart;
        candidateEnd = index;
      }
    }
  }

  if (candidateStart < 0 || candidateEnd < 0) {
    return null;
  }

  return text.slice(candidateStart, candidateEnd + 1);
}

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
