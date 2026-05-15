import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";
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

// === Phase 2 RELY-02: abort-listener-first ordering ===

test("ClaudeStreamJsonCliCleanupProvider registers abort listener before killSession in generate()", () => {
  // Static-source assertion: the order inside generate() must be
  //   1. addEventListener("abort", ...)
  //   2. await this.killSession()
  // We assert this by inspecting the compiled source so a regression in the
  // textual ordering of the file is caught even if the runtime behavior
  // happens to work by coincidence (e.g. abort never fires in the test).
  // Resolve the .ts source from the compiled .js test location:
  //   dist/ai/cleanup/claude-persistent-cli-provider.test.js  →  ../../..  →  repo root
  //   then walk into src/ai/cleanup/claude-persistent-cli-provider.ts
  const here = dirname(fileURLToPath(import.meta.url));
  const sourcePath = resolve(
    here,
    "../../../src/ai/cleanup/claude-persistent-cli-provider.ts",
  );
  const source = readFileSync(sourcePath, "utf8");
  const generateIdx = source.indexOf("async generate(");
  assert.ok(generateIdx >= 0, "generate() method must exist in source");
  // Slice from generate( down to the next `async ` method (or end-of-class) so
  // we don't accidentally pick up an addEventListener in a later method.
  const afterGenerate = source.slice(generateIdx);
  const nextMethodIdx = afterGenerate.slice(20).search(/\n\s{2}async\s/);
  const generateBody =
    nextMethodIdx >= 0
      ? afterGenerate.slice(0, nextMethodIdx + 20)
      : afterGenerate;
  const addListenerIdx = generateBody.indexOf("addEventListener(\"abort\"");
  const killSessionIdx = generateBody.indexOf("await this.killSession()");
  assert.ok(addListenerIdx >= 0, "generate() must register an abort listener");
  assert.ok(killSessionIdx >= 0, "generate() must call await this.killSession()");
  assert.ok(
    addListenerIdx < killSessionIdx,
    `RELY-02 contract violated: addEventListener (${addListenerIdx}) must precede killSession (${killSessionIdx})`,
  );
  // Listener body must use the optional-chain form so it tolerates a null
  // this.session at fire time (the pre-construction abort window).
  assert.match(
    generateBody,
    /this\.session\?\.kill\(\)/,
    "abort listener body must use this.session?.kill() optional chain",
  );
});

test("ClaudeStreamJsonCliCleanupProvider tolerates abort before generate() starts", async () => {
  const provider = new ClaudeStreamJsonCliCleanupProvider({
    command: "claude.exe",
    spawnProcess: () => {
      throw new Error("spawn should never run when abort fires before generate");
    },
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    provider.generate(createProviderInput(), {
      ...createProviderOptions(),
      signal: controller.signal,
    }),
    /cancelled before it started/,
  );
  // No unhandled rejection on the next microtask tick.
  await new Promise((resolve) => setImmediate(resolve));
});

test("ClaudeStreamJsonCliCleanupProvider abort listener body no-ops when session is null", () => {
  // White-box test: reach into the provider, replicate the listener body and
  // fire it against a null session. The optional chain in `this.session?.kill()`
  // must not throw "Cannot read properties of null" — this protects the
  // pre-construction abort window opened by T1's reorder.
  const provider = new ClaudeStreamJsonCliCleanupProvider({
    command: "claude.exe",
    spawnProcess: () => new FakeChildProcess(701),
  });
  // session is private — cast to any to inspect/set for the duration of this test.
  const internal = provider as unknown as {
    session: unknown;
  };
  assert.equal(internal.session, null, "fresh provider must start with null session");
  // Synthesize the listener as written in generate() and invoke it directly.
  const listener = (): void => {
    (provider as unknown as { session?: { kill(): boolean } | null }).session?.kill();
  };
  assert.doesNotThrow(() => listener(), "listener must tolerate null session");
});

// === Phase 2 RELY-01 / TEST-01: trackedPids lifecycle ===

test("ClaudeStreamJsonCliCleanupProvider tracks PID during generate and clears on success", async () => {
  const fake = new FakeChildProcess(401);
  const provider = new ClaudeStreamJsonCliCleanupProvider({
    command: "claude.exe",
    spawnProcess: () => fake,
  });
  const generatePromise = provider.generate(
    createProviderInput(),
    createProviderOptions(),
  );
  emitClaudeTurn(fake, "session_track", '{"ok":true}');
  await generatePromise;
  const internal = provider as unknown as { trackedPids: Set<number> };
  assert.equal(
    internal.trackedPids.size,
    0,
    "trackedPids must be empty after successful generate",
  );
});

test("ClaudeStreamJsonCliCleanupProvider clears trackedPids on abort mid-generate", async () => {
  const fake = new FakeChildProcess(402);
  const provider = new ClaudeStreamJsonCliCleanupProvider({
    command: "claude.exe",
    spawnProcess: () => fake,
  });
  const controller = new AbortController();
  const generatePromise = provider.generate(createProviderInput(), {
    ...createProviderOptions(),
    timeoutMs: 60_000, // large so the abort path is what ends it, not timeout
    signal: controller.signal,
  });
  // Fire abort after the microtask tick so generate() has run past
  // `this.session = session` and `session.start()` (PID was added).
  setImmediate(() => controller.abort());
  await assert.rejects(generatePromise);
  const internal = provider as unknown as { trackedPids: Set<number> };
  assert.equal(
    internal.trackedPids.size,
    0,
    "trackedPids must be empty after aborted generate (TEST-01 primary assertion)",
  );
});

test("ClaudeStreamJsonCliCleanupProvider.reapTrackedPids SIGKILLs every tracked PID and clears the set", () => {
  const provider = new ClaudeStreamJsonCliCleanupProvider({
    command: "claude.exe",
    spawnProcess: () => new FakeChildProcess(0),
  });
  const internal = provider as unknown as { trackedPids: Set<number> };
  internal.trackedPids.add(12345);
  internal.trackedPids.add(12346);

  const calls: Array<{ pid: number; signal: NodeJS.Signals | number }> = [];
  const realKill = process.kill;
  process.kill = ((pid: number, signal: NodeJS.Signals | number) => {
    calls.push({ pid, signal });
    return true;
  }) as typeof process.kill;
  try {
    provider.reapTrackedPids();
  } finally {
    process.kill = realKill;
  }

  assert.equal(calls.length, 2, "process.kill must be called once per tracked PID");
  assert.deepEqual(
    calls.map((c) => c.signal),
    ["SIGKILL", "SIGKILL"],
    "SIGKILL must be the signal sent on the exit-handler reap path",
  );
  assert.deepEqual(
    new Set(calls.map((c) => c.pid)),
    new Set([12345, 12346]),
  );
  assert.equal(internal.trackedPids.size, 0, "trackedPids must be cleared after reap");
});

test("ClaudeStreamJsonCliCleanupProvider.reapTrackedPids swallows ESRCH and still clears the set", () => {
  const provider = new ClaudeStreamJsonCliCleanupProvider({
    command: "claude.exe",
    spawnProcess: () => new FakeChildProcess(0),
  });
  const internal = provider as unknown as { trackedPids: Set<number> };
  internal.trackedPids.add(99999);
  internal.trackedPids.add(99998);

  const realKill = process.kill;
  process.kill = (() => {
    const err = new Error("kill ESRCH") as NodeJS.ErrnoException;
    err.code = "ESRCH";
    throw err;
  }) as typeof process.kill;
  try {
    assert.doesNotThrow(
      () => provider.reapTrackedPids(),
      "reapTrackedPids must be quiet on the exit-handler path (D-04)",
    );
  } finally {
    process.kill = realKill;
  }
  assert.equal(internal.trackedPids.size, 0, "trackedPids must be cleared even on throw");
});

function createProviderInput(): AiCleanupProviderInput {
  return {
    sessionId: "meeting_test",
    language: "ko",
    promptVersion: "phase4-ai-cleanup-v4",
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
