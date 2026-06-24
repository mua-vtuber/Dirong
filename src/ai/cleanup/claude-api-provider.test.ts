import assert from "node:assert/strict";
import test from "node:test";
import {
  ClaudeApiCleanupProvider,
  extractClaudeApiText,
  normalizeClaudeOutputSchema,
  type ClaudeApiFetch,
} from "./claude-api-provider.js";
import { AiCleanupProviderError } from "./provider.js";
import { MEETING_NOTES_DRAFT_JSON_SCHEMA } from "./draft/schema.js";
import type {
  AiCleanupProviderInput,
  AiCleanupProviderOptions,
} from "./provider.js";

test("ClaudeApiCleanupProvider preflight checks Anthropic models with API auth", async () => {
  const calls: Array<{ url: string; headers: Headers }> = [];
  const fetcher: ClaudeApiFetch = async (url, init) => {
    calls.push({ url, headers: new Headers(init.headers) });
    return new Response('{"data":[]}', { status: 200 });
  };
  const provider = new ClaudeApiCleanupProvider({
    apiKey: "sk-ant-test",
    fetcher,
  });

  await provider.preflight();

  assert.equal(calls[0]?.url, "https://api.anthropic.com/v1/models?limit=1");
  assert.equal(calls[0]?.headers.get("x-api-key"), "sk-ant-test");
  assert.equal(calls[0]?.headers.get("anthropic-version"), "2023-06-01");
});

test("ClaudeApiCleanupProvider generates meeting notes with structured output", async () => {
  let requestBody: Record<string, unknown> | null = null;
  const fetcher: ClaudeApiFetch = async (_url, init) => {
    requestBody = JSON.parse(String(init.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        content: [
          {
            type: "text",
            text: '{"schemaVersion":"dirong.meeting_notes_draft.v1"}',
          },
        ],
      }),
      { status: 200 },
    );
  };
  const provider = new ClaudeApiCleanupProvider({
    apiKey: "sk-ant-test",
    model: "sonnet",
    fetcher,
  });

  const result = await provider.generate(fakeInput(), fakeOptions());

  assert.equal(result.provider, "claude-api");
  assert.equal(result.model, "claude-sonnet-4-6");
  assert.equal(result.rawText, '{"schemaVersion":"dirong.meeting_notes_draft.v1"}');
  assert.ok(requestBody);
  const body = requestBody as Record<string, unknown>;
  assert.equal(body.model, "claude-sonnet-4-6");
  assert.equal(body.system, "System prompt");
  assert.deepEqual(
    ((body.output_config as Record<string, unknown>).format as Record<
      string,
      unknown
    >).schema,
    { type: "object" },
  );
});

test("ClaudeApiCleanupProvider maps missing or invalid API auth to provider_auth_required", async () => {
  const missing = new ClaudeApiCleanupProvider();
  await assert.rejects(
    () => missing.preflight(),
    (error) =>
      error instanceof AiCleanupProviderError &&
      error.failureKind === "provider_auth_required",
  );

  const invalid = new ClaudeApiCleanupProvider({
    apiKey: "sk-ant-test",
    fetcher: async () => new Response('{"error":"bad key"}', { status: 401 }),
  });
  await assert.rejects(
    () => invalid.preflight(),
    (error) =>
      error instanceof AiCleanupProviderError &&
      error.failureKind === "provider_auth_required",
  );
});

test("extractClaudeApiText unwraps Messages API text content", () => {
  assert.equal(
    extractClaudeApiText(
      JSON.stringify({
        content: [
          { type: "text", text: '{"ok":true}' },
          { type: "text", text: '{"more":true}' },
        ],
      }),
    ),
    '{"ok":true}\n{"more":true}',
  );
  assert.equal(extractClaudeApiText("plain text"), "plain text");
});

test("normalizeClaudeOutputSchema strips the $schema key", () => {
  const normalized = normalizeClaudeOutputSchema({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
  });
  assert.deepEqual(normalized, {
    type: "object",
    additionalProperties: false,
  });
});

test("normalizeClaudeOutputSchema rewrites object-valued additionalProperties (map pattern)", () => {
  const normalized = normalizeClaudeOutputSchema({
    type: "object",
    additionalProperties: false,
    properties: {
      notionProperties: {
        type: "object",
        additionalProperties: {
          type: "object",
          additionalProperties: false,
          required: ["values"],
          properties: {
            values: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
  });

  assert.deepEqual(normalized, {
    type: "object",
    additionalProperties: false,
    properties: {
      notionProperties: {
        // The object-valued additionalProperties is removed entirely so the
        // node becomes an open object that accepts dynamic keys, while the
        // outer false additionalProperties is preserved verbatim.
        type: "object",
      },
    },
  });
});

test("normalizeClaudeOutputSchema preserves boolean additionalProperties verbatim", () => {
  const normalizedFalse = normalizeClaudeOutputSchema({
    type: "object",
    additionalProperties: false,
    properties: { a: { type: "string" } },
  });
  assert.deepEqual(normalizedFalse, {
    type: "object",
    additionalProperties: false,
    properties: { a: { type: "string" } },
  });

  const normalizedTrue = normalizeClaudeOutputSchema({
    type: "object",
    additionalProperties: true,
  });
  assert.deepEqual(normalizedTrue, {
    type: "object",
    additionalProperties: true,
  });
});

test("normalizeClaudeOutputSchema rewrites the real meeting-notes schema for structured outputs", () => {
  const normalized = normalizeClaudeOutputSchema(
    MEETING_NOTES_DRAFT_JSON_SCHEMA,
  );

  // The $schema key must be gone.
  assert.ok(isRecord(normalized));
  assert.equal(
    Object.prototype.hasOwnProperty.call(normalized, "$schema"),
    false,
  );

  // No object-valued additionalProperties may remain anywhere in the tree;
  // structured outputs only accepts false (or an absent key).
  assertNoObjectAdditionalProperties(normalized);

  // The notionProperties map node specifically must have been opened up:
  // additionalProperties removed, type preserved.
  const notionProperties = (
    (normalized as Record<string, unknown>).properties as Record<
      string,
      unknown
    >
  ).notionProperties as Record<string, unknown>;
  assert.equal(notionProperties.type, "object");
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      notionProperties,
      "additionalProperties",
    ),
    false,
  );

  // The strictly-closed nodes (which already use false) must keep it.
  const summary = (
    (normalized as Record<string, unknown>).properties as Record<
      string,
      unknown
    >
  ).summary as Record<string, unknown>;
  assert.equal(summary.additionalProperties, false);
});

function assertNoObjectAdditionalProperties(node: unknown): void {
  if (Array.isArray(node)) {
    for (const entry of node) {
      assertNoObjectAdditionalProperties(entry);
    }
    return;
  }
  if (!isRecord(node)) {
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "additionalProperties") {
      assert.notEqual(
        isRecord(value),
        true,
        "object-valued additionalProperties must be removed for structured outputs",
      );
    }
    assertNoObjectAdditionalProperties(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fakeInput(): AiCleanupProviderInput {
  return {} as AiCleanupProviderInput;
}

function fakeOptions(): AiCleanupProviderOptions {
  return {
    timeoutMs: 1000,
    maxOutputBytes: 10000,
    systemPrompt: "System prompt",
    userPrompt: "User prompt",
    jsonSchema: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object" },
  };
}
