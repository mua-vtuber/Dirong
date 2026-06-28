import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import {
  buildLocalWhisperWorkerArgs,
  LocalWhisperWorkerProcess,
  type LocalWhisperWorkerChildProcess,
} from "./local-whisper-worker-process.js";

test("buildLocalWhisperWorkerArgs swaps the default one-shot wrapper", () => {
  assert.deepEqual(
    buildLocalWhisperWorkerArgs(["scripts/local-whisper-json.py"]),
    ["scripts/local-whisper-worker.py"],
  );
  assert.deepEqual(
    buildLocalWhisperWorkerArgs(["-u", "scripts\\local-whisper-json.py"]),
    ["-u", "scripts\\local-whisper-worker.py"],
  );
  assert.equal(buildLocalWhisperWorkerArgs(["custom-wrapper.py"]), null);
});

test("LocalWhisperWorkerProcess reuses one process for multiple requests", async () => {
  const spawned: FakeWorkerChild[] = [];
  const worker = new LocalWhisperWorkerProcess({
    command: "python",
    args: ["scripts/local-whisper-worker.py"],
    model: "medium",
    device: "cpu",
    computeType: "int8",
    spawnProcess: (_command, _args, _options) => {
      const child = new FakeWorkerChild(101);
      spawned.push(child);
      return child;
    },
  });

  const started = worker.start({ timeoutMs: 100 });
  spawned[0]?.stdout.write(`${JSON.stringify({ type: "ready", ok: true })}\n`);
  await started;

  const first = worker.request({
    id: "job-1",
    inputAudioPath: "a.webm",
    language: "ko",
    timeoutMs: 100,
  });
  assert.match(spawned[0]?.stdinWrites[0] ?? "", /"input":"a.webm"/);
  spawned[0]?.stdout.write(`${JSON.stringify({
    type: "result",
    id: "job-1",
    ok: true,
    text: " first ",
  })}\n`);
  assert.deepEqual(await first, { text: "first" });

  const second = worker.request({
    id: "job-2",
    inputAudioPath: "b.webm",
    language: null,
    timeoutMs: 100,
  });
  spawned[0]?.stdout.write(`${JSON.stringify({
    type: "result",
    id: "job-2",
    ok: true,
    text: "second",
  })}\n`);

  assert.deepEqual(await second, { text: "second" });
  assert.equal(spawned.length, 1);
});

test("LocalWhisperWorkerProcess kills the worker on request timeout", async () => {
  const spawned: FakeWorkerChild[] = [];
  const worker = new LocalWhisperWorkerProcess({
    command: "python",
    args: ["scripts/local-whisper-worker.py"],
    model: "medium",
    device: "cpu",
    computeType: "int8",
    spawnProcess: () => {
      const child = new FakeWorkerChild(202);
      spawned.push(child);
      return child;
    },
  });

  const started = worker.start({ timeoutMs: 100 });
  spawned[0]?.stdout.write(`${JSON.stringify({ type: "ready", ok: true })}\n`);
  await started;

  await assert.rejects(
    worker.request({
      id: "job-timeout",
      inputAudioPath: "slow.webm",
      language: "ko",
      timeoutMs: 5,
    }),
    /timeout/,
  );
  assert.equal(spawned[0]?.killed, true);
});

class FakeWorkerChild extends EventEmitter implements LocalWhisperWorkerChildProcess {
  readonly stdinWrites: string[] = [];
  readonly stdin = new Writable({
    write: (chunk, _encoding, callback) => {
      this.stdinWrites.push(Buffer.from(chunk).toString("utf8"));
      callback();
    },
  });
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;

  constructor(readonly pid: number) {
    super();
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killed = true;
    this.emit("exit", null, typeof signal === "string" ? signal : null);
    return true;
  }

  override on(event: "error", listener: (error: Error) => void): this;
  override on(
    event: "exit",
    listener: (
      code: number | null,
      signal: NodeJS.Signals | null,
    ) => void,
  ): this;
  override on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }
}
