import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import type { LocalWhisperWorkerChildProcess } from "./local-whisper-worker-process.js";
import { LocalWhisperSttProvider } from "./local-whisper-provider.js";

test("LocalWhisperSttProvider uses a persistent worker after prepare", async () => {
  const spawned: FakeWorkerChild[] = [];
  const provider = new LocalWhisperSttProvider({
    command: "python",
    args: ["scripts/local-whisper-json.py"],
    model: "medium",
    device: "cpu",
    computeType: "int8",
    defaultTimeoutMs: 100,
    workerSpawnProcess: (_command, args) => {
      assert.equal(args[0], "scripts/local-whisper-worker.py");
      const child = new FakeWorkerChild(303);
      spawned.push(child);
      return child;
    },
  });

  const prepared = provider.prepare();
  spawned[0]?.stdout.write(`${JSON.stringify({ type: "ready", ok: true })}\n`);
  await prepared;

  const transcription = provider.transcribe(
    "chunk.webm",
    {
      language: "ko",
      prompt: null,
      sessionId: "session",
      chunkId: "chunk",
      userId: "speaker",
      displayName: "Speaker",
    },
    { timeoutMs: 100 },
  );
  assert.match(spawned[0]?.stdinWrites[0] ?? "", /"input":"chunk.webm"/);
  spawned[0]?.stdout.write(`${JSON.stringify({
    type: "result",
    id: "session:chunk",
    ok: true,
    text: " hello ",
  })}\n`);

  assert.deepEqual(await transcription, { text: "hello" });
  assert.equal(spawned.length, 1);

  await provider.stop();
  assert.match(spawned[0]?.stdinWrites.at(-1) ?? "", /"shutdown"/);
});

class FakeWorkerChild extends EventEmitter implements LocalWhisperWorkerChildProcess {
  readonly stdinWrites: string[] = [];
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;
  readonly stdin = new Writable({
    write: (chunk, _encoding, callback) => {
      const text = Buffer.from(chunk).toString("utf8");
      this.stdinWrites.push(text);
      if (text.includes('"shutdown"')) {
        queueMicrotask(() => this.emit("exit", 0, null));
      }
      callback();
    },
  });

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
