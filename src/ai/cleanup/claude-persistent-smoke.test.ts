import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import {
  ClaudePersistentSmokeSession,
  DEFAULT_CLAUDE_STREAM_JSON_MAX_DIAGNOSTIC_LINES,
  parseClaudeStreamJsonLine,
  type ClaudePersistentSmokeChildProcess,
  type ClaudePersistentSmokeSpawnOptions,
} from "./claude-persistent-smoke.js";

test("parseClaudeStreamJsonLine collects assistant text blocks", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "hello " },
        { type: "tool_use", name: "ignored" },
        { type: "text", text: "world" },
      ],
    },
  });

  const observed = parseClaudeStreamJsonLine(line);

  assert.equal(observed.type, "assistant");
  assert.equal(observed.assistantText, "hello world");
});

test("parseClaudeStreamJsonLine captures session_id", () => {
  const observed = parseClaudeStreamJsonLine(
    JSON.stringify({ type: "system", session_id: "session_123" }),
  );

  assert.equal(observed.sessionId, "session_123");
});

test("parseClaudeStreamJsonLine treats type result as response boundary", () => {
  const observed = parseClaudeStreamJsonLine(
    JSON.stringify({ type: "result", session_id: "session_123" }),
  );

  assert.equal(observed.isResult, true);
});

test("parseClaudeStreamJsonLine tolerates unknown event types", () => {
  const observed = parseClaudeStreamJsonLine(
    JSON.stringify({ type: "experimental_event", value: "ignored" }),
  );

  assert.equal(observed.type, "experimental_event");
  assert.equal(observed.assistantText, "");
  assert.equal(observed.isResult, false);
  assert.equal(observed.parseError, null);
});

test("parseClaudeStreamJsonLine captures malformed JSON", () => {
  const observed = parseClaudeStreamJsonLine("{not json");

  assert.equal(observed.type, null);
  assert.equal(observed.parsed, null);
  assert.equal(observed.assistantText, "");
  assert.equal(observed.isResult, false);
  assert.match(observed.parseError ?? "", /JSON/);
});

test("ClaudePersistentSmokeSession kills process on timeout", async () => {
  const fake = new FakeChildProcess(101);
  const session = new ClaudePersistentSmokeSession({
    command: "claude",
    timeoutMs: 10,
    platform: "linux",
    spawnProcess: () => fake,
  });

  const result = await session.request("hello");

  assert.equal(result.timedOut, true);
  assert.equal(result.resultReceived, false);
  assert.equal(fake.killCalls.length, 1);
  assert.equal(fake.killCalls[0], "SIGTERM");
});

test("ClaudePersistentSmokeSession treats malformed stdout as stream-json protocol failure", async () => {
  const fake = new FakeChildProcess(151);
  const progressKinds: string[] = [];
  const session = new ClaudePersistentSmokeSession({
    command: "claude",
    timeoutMs: 1_000,
    platform: "linux",
    spawnProcess: () => fake,
  });

  const resultPromise = session.request("hello", {
    progress: (progress) => progressKinds.push(progress.kind),
  });
  fake.stdout.write("{not json}\n");
  const result = await resultPromise;

  assert.equal(result.resultReceived, false);
  assert.equal(result.timedOut, false);
  assert.match(result.error ?? "", /stream-json protocol error/);
  assert.equal(result.diagnostics.malformedLineCount, 1);
  assert.equal(result.diagnostics.stdoutLineCount, 1);
  assert.equal(fake.killCalls[0], "SIGTERM");
  assert.deepEqual(progressKinds, [
    "started",
    "waiting_for_first_stream_event",
    "failed",
  ]);
});

test("ClaudePersistentSmokeSession kills large stdout before a newline can grow memory", async () => {
  const fake = new FakeChildProcess(161);
  const session = new ClaudePersistentSmokeSession({
    command: "claude",
    timeoutMs: 1_000,
    platform: "linux",
    spawnProcess: () => fake,
    maxStreamBufferBytes: 64,
  });

  const resultPromise = session.request("hello", { maxOutputBytes: 16 });
  fake.stdout.write("x".repeat(128));
  const result = await resultPromise;

  assert.equal(result.outputExceeded, true);
  assert.equal(result.resultReceived, false);
  assert.match(result.error ?? "", /stdout exceeded max bytes before newline/);
  assert.equal(fake.killCalls[0], "SIGTERM");
});

test("ClaudePersistentSmokeSession kills large stderr before a newline can grow memory", async () => {
  const fake = new FakeChildProcess(162);
  const session = new ClaudePersistentSmokeSession({
    command: "claude",
    timeoutMs: 1_000,
    platform: "linux",
    spawnProcess: () => fake,
    maxStreamBufferBytes: 16,
  });

  const resultPromise = session.request("hello");
  fake.stderr.write("e".repeat(128));
  const result = await resultPromise;

  assert.equal(result.outputExceeded, true);
  assert.equal(result.resultReceived, false);
  assert.match(result.error ?? "", /stderr buffer exceeded max bytes/);
  assert.equal(fake.killCalls[0], "SIGTERM");
});

test("ClaudePersistentSmokeSession keeps diagnostic lines in a ring buffer", async () => {
  const fake = new FakeChildProcess(163);
  const session = new ClaudePersistentSmokeSession({
    command: "claude",
    timeoutMs: 1_000,
    platform: "linux",
    spawnProcess: () => fake,
    maxDiagnosticLines: 2,
  });

  const resultPromise = session.request("hello");
  fake.stderr.write("first\nsecond\nthird\n");
  fake.stdout.write(`${JSON.stringify({ type: "result" })}\n`);
  const result = await resultPromise;

  assert.deepEqual(session.stderrSnapshot, ["second", "third"]);
  assert.deepEqual(result.stderrLines, ["second", "third"]);
  assert.ok(DEFAULT_CLAUDE_STREAM_JSON_MAX_DIAGNOSTIC_LINES >= 2);
});

test("ClaudePersistentSmokeSession writes two turns to the same process", async () => {
  const fake = new FakeChildProcess(202);
  const spawnOptions: ClaudePersistentSmokeSpawnOptions[] = [];
  const session = new ClaudePersistentSmokeSession({
    command: "claude",
    timeoutMs: 1_000,
    platform: "linux",
    spawnProcess: (_command, _args, options) => {
      spawnOptions.push(options);
      return fake;
    },
  });

  const firstPromise = session.request("first prompt");
  fake.stdout.write(
    `${JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "first answer" }] },
      session_id: "session_abc",
    })}\n`,
  );
  fake.stdout.write(`${JSON.stringify({ type: "result" })}\n`);
  const first = await firstPromise;

  const secondPromise = session.request("second prompt");
  fake.stdout.write(
    `${JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "second answer" }] },
      session_id: "session_abc",
    })}\n`,
  );
  fake.stdout.write(`${JSON.stringify({ type: "result" })}\n`);
  const second = await secondPromise;

  assert.equal(first.resultReceived, true);
  assert.equal(second.resultReceived, true);
  assert.equal(first.pidAfterResult, 202);
  assert.equal(second.pidBeforeWrite, 202);
  assert.equal(session.isAlive(), true);
  assert.equal(fake.stdinWrites.length, 2);
  assert.match(fake.stdinWrites[0] ?? "", /first prompt/);
  assert.match(fake.stdinWrites[1] ?? "", /second prompt/);
  assert.equal(first.assistantText, "first answer");
  assert.equal(second.assistantText, "second answer");
  assert.equal(second.sessionId, "session_abc");
  const capturedSpawnOptions = spawnOptions[0];
  if (!capturedSpawnOptions) {
    throw new Error("spawn options were not captured");
  }
  assert.equal(capturedSpawnOptions.shell, false);
});

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
