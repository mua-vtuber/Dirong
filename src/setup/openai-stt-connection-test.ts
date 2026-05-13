import { redactSensitiveText } from "../errors.js";

const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";
const DEFAULT_OPENAI_STT_TEST_TIMEOUT_MS = 10000;

export type OpenAiSttConnectionTestInput = {
  apiKey: string;
  model: string;
  timeoutMs?: number;
};

export type OpenAiSttConnectionTestResult =
  | {
      ok: true;
      model: string;
      detail: string | null;
    }
  | {
      ok: false;
      model: string;
      detail: string;
      statusCode: number | null;
    };

export type OpenAiSttConnectionTester = {
  test(input: OpenAiSttConnectionTestInput): Promise<OpenAiSttConnectionTestResult>;
};

export class DefaultOpenAiSttConnectionTester
  implements OpenAiSttConnectionTester {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async test(
    input: OpenAiSttConnectionTestInput,
  ): Promise<OpenAiSttConnectionTestResult> {
    const apiKey = input.apiKey.trim();
    const model = input.model.trim();
    if (!apiKey) {
      return {
        ok: false,
        model,
        statusCode: null,
        detail: "OpenAI API key is required.",
      };
    }
    if (!model) {
      return {
        ok: false,
        model,
        statusCode: null,
        detail: "OpenAI STT model is required.",
      };
    }

    const controller = new AbortController();
    const timeoutMs = input.timeoutMs ?? DEFAULT_OPENAI_STT_TEST_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl(
        `${OPENAI_MODELS_URL}/${encodeURIComponent(model)}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          signal: controller.signal,
        },
      );
      const body = await response.text();
      if (!response.ok) {
        return {
          ok: false,
          model,
          statusCode: response.status,
          detail: `OpenAI model check failed (${response.status}): ${extractOpenAiError(body)}`,
        };
      }

      const parsed = JSON.parse(body) as { id?: unknown; object?: unknown };
      if (typeof parsed.id !== "string" || typeof parsed.object !== "string") {
        return {
          ok: false,
          model,
          statusCode: response.status,
          detail: "OpenAI model check returned an unexpected response.",
        };
      }

      return {
        ok: true,
        model: parsed.id,
        detail: parsed.id === model ? null : `OpenAI returned model ${parsed.id}.`,
      };
    } catch (error) {
      const detail =
        error instanceof Error && error.name === "AbortError"
          ? `OpenAI model check timed out after ${timeoutMs}ms.`
          : error instanceof Error
            ? error.message
            : String(error);
      return {
        ok: false,
        model,
        statusCode: null,
        detail: redactSensitiveText(detail),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

function extractOpenAiError(body: string): string {
  let message = body;
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: unknown; type?: unknown; code?: unknown };
    };
    const error = parsed.error;
    if (error?.message) {
      message = [
        String(error.message),
        error.type ? `type=${String(error.type)}` : "",
        error.code ? `code=${String(error.code)}` : "",
      ].filter(Boolean).join(" ");
    }
  } catch {
    // Keep the raw body fallback below.
  }

  const redacted = redactSensitiveText(message);
  return redacted.length <= 1000 ? redacted : `${redacted.slice(0, 1000)}...`;
}
