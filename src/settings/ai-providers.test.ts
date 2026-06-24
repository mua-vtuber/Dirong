import assert from "node:assert/strict";
import test from "node:test";
import {
  supportsAiProviderMode,
  isAiProviderName,
  isAiProviderMode,
} from "./ai-providers.js";

test("supportsAiProviderMode allows both cli and api for claude", () => {
  assert.equal(supportsAiProviderMode("claude", "cli"), true);
  assert.equal(supportsAiProviderMode("claude", "api"), true);
});

test("supportsAiProviderMode allows cli but rejects api for codex", () => {
  assert.equal(supportsAiProviderMode("codex", "cli"), true);
  assert.equal(supportsAiProviderMode("codex", "api"), false);
});

test("supportsAiProviderMode allows cli but rejects api for gemini", () => {
  assert.equal(supportsAiProviderMode("gemini", "cli"), true);
  assert.equal(supportsAiProviderMode("gemini", "api"), false);
});

test("isAiProviderName accepts known providers and rejects unknown input", () => {
  assert.equal(isAiProviderName("claude"), true);
  assert.equal(isAiProviderName("codex"), true);
  assert.equal(isAiProviderName("gemini"), true);
  assert.equal(isAiProviderName("foo"), false);
  assert.equal(isAiProviderName(123), false);
  assert.equal(isAiProviderName(null), false);
});

test("isAiProviderMode accepts known modes and rejects unknown input", () => {
  assert.equal(isAiProviderMode("cli"), true);
  assert.equal(isAiProviderMode("api"), true);
  assert.equal(isAiProviderMode("rest"), false);
  assert.equal(isAiProviderMode(undefined), false);
});
