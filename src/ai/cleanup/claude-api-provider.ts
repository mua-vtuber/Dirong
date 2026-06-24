import { redactSensitiveText } from "../../errors.js";
import { DEFAULT_AI_CLEANUP_SETTINGS } from "../../settings/defaults.js";
import {
  AiCleanupProviderError,
  type AiCleanupProvider,
  type AiCleanupProviderInput,
  type AiCleanupProviderOptions,
  type AiCleanupProviderResult,
} from "./provider.js";
import { resolveClaudeApiModelName } from "./claude-models.js";

export type ClaudeApiCleanupProviderOptions = {
  apiKey?: string | null;
  model?: string | null;
  baseUrl?: string;
  fetcher?: ClaudeApiFetch;
};

export type ClaudeApiFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

export class ClaudeApiCleanupProvider implements AiCleanupProvider {
  readonly providerName = "claude-api";
  readonly modelName: string;
  readonly supportsJsonSchema = true;
  readonly supportsWarmSession = false;
  readonly supportsStreamingProgress = false;

  private readonly apiKey: string | null;
  private readonly baseUrl: string;
  private readonly fetcher: ClaudeApiFetch;

  constructor(options: ClaudeApiCleanupProviderOptions = {}) {
    this.apiKey = options.apiKey?.trim() || null;
    this.modelName = resolveClaudeApiModelName(options.model);
    this.baseUrl = (options.baseUrl ?? "https://api.anthropic.com").replace(
      /\/+$/,
      "",
    );
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  }

  async preflight(): Promise<void> {
    await this.request("/v1/models?limit=1", {
      method: "GET",
      timeoutMs: DEFAULT_AI_CLEANUP_SETTINGS.prepareTimeoutMs,
    });
  }

  async generate(
    _input: AiCleanupProviderInput,
    options: AiCleanupProviderOptions,
  ): Promise<AiCleanupProviderResult> {
    if (options.signal?.aborted) {
      throw new AiCleanupProviderError(
        "provider_timeout",
        "Claude API request was cancelled before it started.",
      );
    }

    const startedAt = Date.now();
    const responseText = await this.request("/v1/messages", {
      method: "POST",
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      body: JSON.stringify({
        model: this.modelName,
        max_tokens: maxTokensForOutputBytes(options.maxOutputBytes),
        system: options.systemPrompt,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: options.userPrompt,
              },
            ],
          },
        ],
        output_config: {
          format: {
            type: "json_schema",
            schema: normalizeClaudeOutputSchema(options.jsonSchema),
          },
        },
      }),
    });

    return {
      provider: this.providerName,
      model: this.modelName,
      commandDisplay: `POST ${this.baseUrl}/v1/messages`,
      rawText: extractClaudeApiText(responseText),
      stderrText: "",
      exitCode: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  private async request(
    path: string,
    options: {
      method: "GET" | "POST";
      timeoutMs: number;
      body?: string;
      signal?: AbortSignal;
    },
  ): Promise<string> {
    if (!this.apiKey) {
      throw new AiCleanupProviderError(
        "provider_auth_required",
        "Claude API key is missing.",
      );
    }

    const controller = new AbortController();
    const abort = (): void => controller.abort();
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(
      abort,
      options.timeoutMs,
    );
    options.signal?.addEventListener("abort", abort, { once: true });

    try {
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        method: options.method,
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: options.body,
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new AiCleanupProviderError(
          response.status === 401 || response.status === 403
            ? "provider_auth_required"
            : "provider_nonzero_exit",
          `Claude API request failed (${response.status}): ${redactSensitiveText(
            text.slice(0, 1000),
          )}`,
        );
      }
      return text;
    } catch (error) {
      if (isAbortLikeError(error)) {
        throw new AiCleanupProviderError(
          "provider_timeout",
          "Claude API request timed out or was cancelled.",
        );
      }
      if (error instanceof AiCleanupProviderError) {
        throw error;
      }
      throw new AiCleanupProviderError(
        "unknown",
        `Claude API request failed: ${errorMessage(error)}`,
      );
    } finally {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      options.signal?.removeEventListener("abort", abort);
    }
  }
}

export function extractClaudeApiText(responseText: string): string {
  const parsed = parseJson(responseText);
  if (parsed === null) {
    return responseText;
  }
  const text = findClaudeContentText(parsed);
  return text ?? responseText;
}

export function normalizeClaudeOutputSchema(schema: unknown): unknown {
  if (!isRecord(schema)) {
    return schema;
  }
  const { $schema: _schema, ...rest } = schema;
  return normalizeSchemaNode(rest);
}

/**
 * Recursively rewrites a JSON Schema into a shape that Anthropic structured
 * outputs (`output_config.format.schema`) accepts.
 *
 * Anthropic structured outputs reject any object whose `additionalProperties`
 * is set to anything other than `false`. The meeting-notes schema uses an
 * object-valued `additionalProperties` for one map (dictionary) node —
 * `notionProperties` — to allow dynamic, model-chosen property keys. That node
 * is what gets rejected on the API path.
 *
 * The transform here removes only the offending `additionalProperties` key on
 * such map nodes, turning them into open objects (`additionalProperties`
 * absent => unconstrained). This keeps the map semantics intact: the model can
 * still emit dynamic keys whose values match the inner shape constraints, and
 * the response-consumption contract (which reads `notionProperties[name]` as a
 * dynamic map and never relies on the JSON Schema for that node) is unchanged.
 *
 * A boolean `additionalProperties` (`false`/`true`) is already accepted by
 * structured outputs and is preserved verbatim; only the object-valued form is
 * rewritten.
 */
function normalizeSchemaNode(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map((entry) => normalizeSchemaNode(entry));
  }
  if (!isRecord(node)) {
    return node;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "additionalProperties" && isRecord(value)) {
      // Map/dictionary node: drop the object-valued `additionalProperties`
      // entirely so structured outputs accepts the node while its dynamic keys
      // stay open. The removed inner shape is not re-emitted on purpose —
      // keeping it in any form would re-trigger the structured-outputs
      // rejection. The map values are validated downstream by the draft
      // validator, not by this schema.
      continue;
    }
    result[key] = normalizeSchemaNode(value);
  }
  return result;
}

function maxTokensForOutputBytes(maxOutputBytes: number): number {
  return Math.min(64_000, Math.max(1_024, Math.floor(maxOutputBytes / 16)));
}

function findClaudeContentText(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }
  const content = value.content;
  if (!Array.isArray(content)) {
    return null;
  }
  const texts = content
    .map((block) => (isRecord(block) && typeof block.text === "string" ? block.text : null))
    .filter((text): text is string => text !== null);
  return texts.length > 0 ? texts.join("\n") : null;
}

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isAbortLikeError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.message.toLowerCase().includes("abort"))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
