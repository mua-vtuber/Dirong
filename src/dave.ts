const INTERESTING_KEY = /dave|encrypt|decrypt|protocol|session|mode|mls/i;
const SKIP_KEY = /adapter|client|guild|receiver|subscription|networking|udp|ws/i;

export function extractDaveEvidence(value: unknown): unknown[] {
  const output: unknown[] = [];
  visit(value, "state", output, new Set(), 0);
  return output.slice(0, 30);
}

function visit(
  value: unknown,
  path: string,
  output: unknown[],
  seen: Set<object>,
  depth: number,
): void {
  if (depth > 4 || output.length >= 30) {
    return;
  }

  if (typeof value !== "object" || value === null) {
    return;
  }

  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  for (const [key, entry] of Object.entries(value)) {
    if (SKIP_KEY.test(key) && !INTERESTING_KEY.test(key)) {
      continue;
    }

    const nextPath = `${path}.${key}`;
    if (INTERESTING_KEY.test(key) && isLoggablePrimitive(entry)) {
      output.push({ path: nextPath, value: entry });
      continue;
    }

    if (typeof entry === "object" && entry !== null) {
      if (INTERESTING_KEY.test(key)) {
        output.push({
          path: nextPath,
          value: summarizeObject(entry),
        });
      }
      visit(entry, nextPath, output, seen, depth + 1);
    }
  }
}

function isLoggablePrimitive(value: unknown): boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  );
}

function summarizeObject(value: object): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value).slice(0, 20)) {
    if (isLoggablePrimitive(entry)) {
      output[key] = entry;
    }
  }
  return output;
}
