import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import {
  ClaudeStreamJsonCliCleanupProvider,
  buildPersistentCleanupExtraArgs,
  type CommandExitRunner,
} from "./claude-persistent-cli-provider.js";
import type {
  AiCleanupProviderInput,
  AiCleanupProviderOptions,
} from "./provider.js";
import type {
  ClaudePersistentSmokeChildProcess,
  ClaudePersistentSmokeSpawnOptions,
} from "./claude-persistent-smoke.js";
import { makeAiCleanupProgressContext } from "./progress.js";

test("ClaudeStreamJsonCliCleanupProvider preflight uses version command", async () => {
  let capturedCommand = "";
  let capturedArgs: string[] = [];
  const versionRunner: CommandExitRunner = async (command, args) => {
    capturedCommand = command;
    capturedArgs = args;
    return {
      stdout: "1.0.0",
      stderr: "",
      exitCode: 0,
      timedOut: false,
    };
  };
  const provider = new ClaudeStreamJsonCliCleanupProvider({
    command: "claude.exe",
    versionRunner,
  });

  await provider.preflight();

  assert.equal(capturedCommand, "claude.exe");
  assert.deepEqual(capturedArgs, ["--version"]);
});

test("ClaudeStreamJsonCliCleanupProvider uses a fresh stream-json process per request", async () => {
  const fake1 = new FakeChildProcess(303);
  const fake2 = new FakeChildProcess(404);
  const fakes = [fake1, fake2];
  const spawnedFakes: FakeChildProcess[] = [];
  const spawnCalls: Array<{
    command: string;
    args: string[];
    options: ClaudePersistentSmokeSpawnOptions;
  }> = [];
  const provider = new ClaudeStreamJsonCliCleanupProvider({
    command: "claude.exe",
    spawnProcess: (command, args, options) => {
      spawnCalls.push({ command, args, options });
      const fake = fakes.shift();
      if (!fake) {
        throw new Error("unexpected extra spawn");
      }
      spawnedFakes.push(fake);
      return fake;
    },
  });
  assert.equal(provider.supportsWarmSession, false);
  assert.equal(provider.supportsStreamingProgress, true);

  const firstPromise = provider.generate(createProviderInput(), createProviderOptions());
  emitClaudeTurn(fake1, "session_1", '{"ok":true}');
  const first = await firstPromise;

  const secondPromise = provider.generate(createProviderInput(), {
    ...createProviderOptions(),
    userPrompt: "repair prompt",
  });
  emitClaudeTurn(fake2, "session_2", '{"repaired":true}');
  const second = await secondPromise;

  assert.equal(spawnCalls.length, 2);
  assert.equal(spawnCalls[0]?.command, "claude.exe");
  assert.equal(spawnCalls[0]?.options.shell, false);
  assert.deepEqual(spawnCalls[0]?.args.slice(0, 5), [
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
  ]);
  assert.ok(spawnCalls[0]?.args.includes("--system-prompt"));
  assert.ok(spawnCalls[0]?.args.includes("--json-schema"));
  assert.deepEqual(spawnCalls[0]?.args.slice(-2), ["--model", "haiku"]);
  assert.equal((spawnCalls[1]?.args ?? []).join(" "), (spawnCalls[0]?.args ?? []).join(" "));
  assert.match(first.rawText, /"type":"result"/);
  assert.match(second.rawText, /\\"repaired\\":true/);
  assert.equal(first.exitCode, 0);
  assert.equal(second.exitCode, 0);
  assert.deepEqual(spawnedFakes, [fake1, fake2]);
  assert.equal(fake1.stdinWrites.length, 1);
  assert.equal(fake2.stdinWrites.length, 1);
  assert.match(fake1.stdinWrites[0] ?? "", /meeting notes prompt/);
  assert.match(fake2.stdinWrites[0] ?? "", /repair prompt/);
  assert.deepEqual(fake1.killCalls, ["SIGTERM"]);
  assert.deepEqual(fake2.killCalls, ["SIGTERM"]);
});

test("buildPersistentCleanupExtraArgs keeps schema and system prompt in CLI args", () => {
  assert.deepEqual(buildPersistentCleanupExtraArgs(createProviderOptions()), [
    "--tools",
    "",
    "--system-prompt",
    "system prompt",
    "--json-schema",
    '{"type":"object"}',
  ]);
});

test("ClaudeStreamJsonCliCleanupProvider emits redacted progress metadata", async () => {
  const fake = new FakeChildProcess(505);
  const snapshots: unknown[] = [];
  const provider = new ClaudeStreamJsonCliCleanupProvider({
    command: "claude.exe",
    spawnProcess: () => fake,
  });
  const progressContext = makeAiCleanupProgressContext({
    sessionId: "meeting_progress",
    jobId: "ai_progress",
    provider: "claude-cli",
    model: "haiku",
    attempt: 1,
  });

  const resultPromise = provider.generate(createProviderInput(), {
    ...createProviderOptions(),
    progressContext,
    progress: (snapshot) => snapshots.push(snapshot),
  });
  emitClaudeTurn(fake, "session_progress", "SECRET_CANARY_RESPONSE");
  const result = await resultPromise;

  assert.equal(result.exitCode, 0);
  assert.ok(
    snapshots.some(
      (snapshot) =>
        isRecord(snapshot) && snapshot.phase === "result_boundary_received",
    ),
  );
  assert.doesNotMatch(JSON.stringify(snapshots), /SECRET_CANARY_RESPONSE/);
  const last = snapshots.at(-1);
  assert.ok(isRecord(last));
  assert.equal(last.lastEventType, "result");
  assert.equal(last.resultReceived, true);
});

function emitClaudeTurn(
  fake: FakeChildProcess,
  sessionId: string,
  text: string,
): void {
  fake.stdout.write(
    `${JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text }] },
      session_id: sessionId,
    })}\n`,
  );
  fake.stdout.write(
    `${JSON.stringify({
      type: "result",
      result: text,
      session_id: sessionId,
    })}\n`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class FakeChildProcess
  extends EventEmitter
  implements ClaudePersistentSmokeChildProcess
{
  readonly stdinWrites: string[] = [];
  readonly stdin = new Writable({
    write: (chunk, _encoding, callback) => {
      this.stdinWrites.push(
        typeof chunk === "string" ? chunk : chunk.toString("utf8"),
      );
      callback();
    },
  });
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;
  readonly killCalls: Array<NodeJS.Signals | number | undefined> = [];

  constructor(readonly pid: number) {
    super();
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killed = true;
    this.killCalls.push(signal);
    this.emit("exit", null, typeof signal === "string" ? signal : null);
    return true;
  }

  override on(
    event: "error",
    listener: (error: Error) => void,
  ): this;
  override on(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
  override on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }
}

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
    systemPrompt: "system prompt",
    userPrompt: "meeting notes prompt",
    jsonSchema: { type: "object" },
  };
}
