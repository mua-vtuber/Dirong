import assert from "node:assert/strict";
import test from "node:test";
import type { AiCleanupProviderInput, AiCleanupProviderOptions } from "./provider.js";
import {
  ClaudeCliCleanupProvider,
  DEFAULT_CLAUDE_CLEANUP_MODEL,
  type CommandRunner,
} from "./claude-cli-provider.js";

test("ClaudeCliCleanupProvider defaults to Haiku and passes it to Claude CLI", async () => {
  let capturedArgs: string[] = [];
  const runner: CommandRunner = async (_command, args) => {
    capturedArgs = args;
    return {
      stdout: "{}",
      stderr: "",
      exitCode: 0,
      timedOut: false,
      outputExceeded: false,
      durationMs: 1,
    };
  };
  const provider = new ClaudeCliCleanupProvider({ runner });

  assert.equal(provider.modelName, DEFAULT_CLAUDE_CLEANUP_MODEL);

  await provider.generate(createProviderInput(), createProviderOptions());

  const modelIndex = capturedArgs.indexOf("--model");
  assert.notEqual(modelIndex, -1);
  assert.deepEqual(
    capturedArgs.slice(modelIndex, modelIndex + 2),
    ["--model", "haiku"],
  );
});

test("ClaudeCliCleanupProvider keeps explicit model overrides", () => {
  const provider = new ClaudeCliCleanupProvider({ model: "sonnet" });
  assert.equal(provider.modelName, "sonnet");
});

function createProviderInput(): AiCleanupProviderInput {
  return {
    sessionId: "meeting_test",
    language: "ko",
    promptVersion: "phase4-ai-cleanup-v2",
    outputSchemaVersion: "dirong.meeting_notes_draft.v1",
    timeline: {
      contractVersion: "phase3.5-transcript-timeline-v1",
      sessionId: "meeting_test",
      includeNoSpeech: false,
      includeFakeStt: false,
      entries: [],
    },
    timelineMarkdown: "",
    inputHash: "hash",
  };
}

function createProviderOptions(): AiCleanupProviderOptions {
  return {
    timeoutMs: 1000,
    maxOutputBytes: 1000,
    systemPrompt: "system",
    userPrompt: "user",
    jsonSchema: {},
  };
}
