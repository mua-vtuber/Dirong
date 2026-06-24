import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  extractGeminiResponseText,
  TerminalCliCleanupProvider,
  type TerminalCliRunner,
} from "./terminal-cli-provider.js";
import type {
  AiCleanupProviderInput,
  AiCleanupProviderOptions,
} from "./provider.js";

test("TerminalCliCleanupProvider invokes codex exec with an output schema file", async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "dirong-terminal-provider-"));
  const calls: Array<{ command: string; args: string[]; stdin: string }> = [];
  let schemaText = "";
  const runner: TerminalCliRunner = async (command, args, options) => {
    calls.push({ command, args, stdin: options.stdin });
    const schemaPath = args[args.indexOf("--output-schema") + 1];
    const outputPath = args[args.indexOf("--output-last-message") + 1];
    if (!schemaPath || !outputPath) {
      throw new Error("expected codex schema and output paths");
    }
    schemaText = readFileSync(schemaPath, "utf8");
    writeFileSync(outputPath, '{"schemaVersion":"dirong.meeting_notes_draft.v1"}');
    return {
      stdout: "codex progress output",
      stderr: "",
      exitCode: 0,
      timedOut: false,
    };
  };

  try {
    const provider = new TerminalCliCleanupProvider({
      kind: "codex",
      command: "codex",
      model: "default",
      runner,
      tempRoot,
    });

    const result = await provider.generate(fakeInput(), fakeOptions());

    assert.equal(result.provider, "codex-cli");
    assert.equal(result.model, "default");
    assert.equal(result.rawText, '{"schemaVersion":"dirong.meeting_notes_draft.v1"}');
    assert.equal(calls[0]?.command, "codex");
    assert.deepEqual(calls[0]?.args.slice(0, 2), ["exec", "--skip-git-repo-check"]);
    assert.ok(
      !calls[0]?.args.includes("--ask-for-approval"),
      "codex exec must not pass --ask-for-approval (removed in codex 0.139.0)",
    );
    assert.match(calls[0]?.stdin ?? "", /System prompt/);
    assert.equal(schemaText, '{"type":"object"}');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("extractGeminiResponseText unwraps common Gemini JSON output shapes", () => {
  assert.equal(
    extractGeminiResponseText(JSON.stringify({ response: { text: '{"ok":true}' } })),
    '{"ok":true}',
  );
  assert.equal(
    extractGeminiResponseText(
      JSON.stringify({ schemaVersion: "dirong.meeting_notes_draft.v1" }),
    ),
    '{"schemaVersion":"dirong.meeting_notes_draft.v1"}',
  );
  assert.equal(extractGeminiResponseText("plain text"), "plain text");
});

test("TerminalCliCleanupProvider invokes gemini with plan approval mode and json output format", async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "dirong-gemini-provider-"));
  const calls: Array<{ command: string; args: string[]; stdin: string }> = [];
  const runner: TerminalCliRunner = async (command, args, options) => {
    calls.push({ command, args, stdin: options.stdin });
    return {
      stdout: "plain gemini text",
      stderr: "",
      exitCode: 0,
      timedOut: false,
    };
  };

  try {
    const provider = new TerminalCliCleanupProvider({
      kind: "gemini",
      command: "gemini",
      model: "default",
      runner,
      tempRoot,
    });

    const result = await provider.generate(fakeInput(), fakeOptions());

    assert.equal(result.provider, "gemini-cli");
    assert.equal(result.rawText, "plain gemini text");
    assert.equal(calls[0]?.command, "gemini");
    const args = calls[0]?.args ?? [];
    assert.ok(args.includes("--output-format"));
    assert.equal(args[args.indexOf("--output-format") + 1], "json");
    assert.ok(args.includes("--approval-mode"));
    assert.equal(args[args.indexOf("--approval-mode") + 1], "plan");
    assert.ok(!args.includes("--model"));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

function fakeInput(): AiCleanupProviderInput {
  return {} as AiCleanupProviderInput;
}

function fakeOptions(): AiCleanupProviderOptions {
  return {
    timeoutMs: 1000,
    maxOutputBytes: 10000,
    systemPrompt: "System prompt",
    userPrompt: "User prompt",
    jsonSchema: { type: "object" },
  };
}
