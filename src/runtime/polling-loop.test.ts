import assert from "node:assert/strict";
import test from "node:test";
import { PollingLoop, type PollingLoopTimer } from "./polling-loop.js";

test("PollingLoop coalesces concurrent runOnce calls", async () => {
  const tick = createDeferred<number>();
  let runCalls = 0;
  const loop = new PollingLoop<number>({
    intervalMs: 1000,
    runTick: async () => {
      runCalls += 1;
      return await tick.promise;
    },
  });

  const first = loop.runOnce();
  const second = loop.runOnce();

  assert.equal(runCalls, 1);
  tick.resolve(42);
  assert.equal(await first, 42);
  assert.equal(await second, 42);
});

test("PollingLoop stop clears timer and waits for in-flight tick", async () => {
  const clock = new ManualClock();
  const tick = createDeferred<void>();
  let tickCompleted = false;
  const loop = new PollingLoop<string>({
    intervalMs: 1000,
    setTimeout: (callback, delayMs) => clock.setTimeout(callback, delayMs),
    clearTimeout: (timer) => clock.clearTimeout(timer),
    runTick: async () => {
      await tick.promise;
      tickCompleted = true;
      return "done";
    },
  });

  loop.start();
  assert.equal(clock.pendingTimerCount(), 1);
  assert.equal(clock.unrefCalls, 1);

  clock.tick(0);
  const stopped = loop.stop();
  assert.equal(clock.pendingTimerCount(), 0);
  assert.equal(tickCompleted, false);

  tick.resolve();
  await stopped;
  assert.equal(tickCompleted, true);
  assert.equal(clock.pendingTimerCount(), 0);
});

test("PollingLoop stop aborts in-flight tick and returns after bounded wait", async () => {
  let observedSignal: AbortSignal | null = null;
  const runningForever = new Promise<void>(() => {
    // Intentionally left pending to prove stop does not wait forever.
  });
  const loop = new PollingLoop<void>({
    intervalMs: 1000,
    stopWaitMs: 5,
    runTick: async (signal) => {
      observedSignal = signal;
      await runningForever;
    },
  });

  const running = loop.runOnce();
  const startedAt = Date.now();
  await loop.stop();
  const elapsedMs = Date.now() - startedAt;

  const signal = observedSignal as unknown as AbortSignal;
  assert.equal(signal.aborted, true);
  assert.ok(elapsedMs < 100, `stop waited too long: ${elapsedMs}ms`);
  assert.equal(
    await Promise.race([
      running.then(() => "resolved"),
      delay(10).then(() => "pending"),
    ]),
    "pending",
  );
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

class ManualClock {
  unrefCalls = 0;
  private nextId = 1;
  private readonly timers = new Map<
    number,
    { dueMs: number; callback: () => void }
  >();

  setTimeout(callback: () => void, delayMs: number): PollingLoopTimer {
    const id = this.nextId;
    this.nextId += 1;
    this.timers.set(id, { dueMs: delayMs, callback });
    return {
      unref: () => {
        this.unrefCalls += 1;
      },
      [Symbol.toPrimitive]: () => id,
    } as unknown as PollingLoopTimer;
  }

  clearTimeout(timer: PollingLoopTimer): void {
    this.timers.delete(Number(timer));
  }

  pendingTimerCount(): number {
    return this.timers.size;
  }

  tick(ms: number): void {
    const due = [...this.timers.entries()]
      .filter(([, timer]) => timer.dueMs <= ms)
      .sort((a, b) => a[1].dueMs - b[1].dueMs);
    for (const [id, timer] of due) {
      this.timers.delete(id);
      timer.callback();
    }
  }
}
