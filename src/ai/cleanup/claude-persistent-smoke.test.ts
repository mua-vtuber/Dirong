import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import {
  ClaudePersistentSmokeSession,
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
