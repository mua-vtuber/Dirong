import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveClaudeApiModelName,
  DEFAULT_CLAUDE_CLEANUP_MODEL,
} from "./claude-models.js";

const HAIKU_FULL = "claude-haiku-4-5";
const SONNET_FULL = "claude-sonnet-4-6";
const OPUS_FULL = "claude-opus-4-8";

test("resolveClaudeApiModelName maps short aliases to full model versions", () => {
  assert.equal(resolveClaudeApiModelName("haiku"), HAIKU_FULL);
  assert.equal(resolveClaudeApiModelName("sonnet"), SONNET_FULL);
  assert.equal(resolveClaudeApiModelName("opus"), OPUS_FULL);
});

test("resolveClaudeApiModelName falls back to haiku for default and empty values", () => {
  assert.equal(resolveClaudeApiModelName("default"), HAIKU_FULL);
  assert.equal(resolveClaudeApiModelName(""), HAIKU_FULL);
  assert.equal(resolveClaudeApiModelName(null), HAIKU_FULL);
  assert.equal(resolveClaudeApiModelName(undefined), HAIKU_FULL);
});

test("resolveClaudeApiModelName passes through an already-resolved full model id", () => {
  assert.equal(resolveClaudeApiModelName(OPUS_FULL), OPUS_FULL);
});

test("resolveClaudeApiModelName trims surrounding whitespace before alias lookup", () => {
  assert.equal(resolveClaudeApiModelName("  sonnet  "), SONNET_FULL);
});

test("DEFAULT_CLAUDE_CLEANUP_MODEL is haiku", () => {
  assert.equal(DEFAULT_CLAUDE_CLEANUP_MODEL, "haiku");
});
