export type PollingLoopTimer = ReturnType<typeof setTimeout> & {
  unref?: () => void;
};

export const DEFAULT_POLLING_LOOP_STOP_WAIT_MS = 10000;

export type PollingLoopOptions<T> = {
  intervalMs: number;
  runTick: (signal: AbortSignal) => Promise<T>;
  stopWaitMs?: number;
  onScheduledError?: (error: unknown) => void | Promise<void>;
  setTimeout?: (callback: () => void, delayMs: number) => PollingLoopTimer;
  clearTimeout?: (timer: PollingLoopTimer) => void;
};

export class PollingLoop<T> {
  private timer: PollingLoopTimer | null = null;
  private tickPromise: Promise<T> | null = null;
  private tickAbortController: AbortController | null = null;
  private started = false;
  private stopping = false;
  private readonly setTimer: (
    callback: () => void,
    delayMs: number,
  ) => PollingLoopTimer;
  private readonly clearTimer: (timer: PollingLoopTimer) => void;

  constructor(private readonly options: PollingLoopOptions<T>) {
    this.setTimer = options.setTimeout ?? setTimeout;
    this.clearTimer = options.clearTimeout ?? clearTimeout;
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.stopping = false;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.started = false;
    this.stopping = true;
    if (this.timer) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    const tickPromise = this.tickPromise;
    if (tickPromise) {
      this.tickAbortController?.abort();
      await waitForPromiseOrTimeout(
        tickPromise,
        this.options.stopWaitMs ?? DEFAULT_POLLING_LOOP_STOP_WAIT_MS,
      );
    }
  }

  async runOnce(): Promise<T> {
    if (this.tickPromise) {
      return await this.tickPromise;
    }

    const abortController = new AbortController();
    this.tickAbortController = abortController;
    this.tickPromise = this.options.runTick(abortController.signal);
    try {
      return await this.tickPromise;
    } finally {
      if (this.tickAbortController === abortController) {
        this.tickAbortController = null;
      }
      this.tickPromise = null;
    }
  }

  private schedule(delayMs: number): void {
    if (!this.started || this.stopping) {
      return;
    }
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.runScheduledTick();
    }, Math.max(0, delayMs));
    this.timer.unref?.();
  }

  private async runScheduledTick(): Promise<void> {
    try {
      await this.runOnce();
    } catch (error) {
      await this.options.onScheduledError?.(error);
    } finally {
      this.schedule(this.options.intervalMs);
    }
  }
}

export type EnabledPollingLoopOptions<T> = PollingLoopOptions<T> & {
  enabled: () => boolean;
};

export class EnabledPollingLoop<T> {
  private readonly loop: PollingLoop<T>;

  constructor(private readonly options: EnabledPollingLoopOptions<T>) {
    this.loop = new PollingLoop(options);
  }

  start(): void {
    if (this.options.enabled()) {
      this.loop.start();
    }
  }

  async stop(): Promise<void> {
    await this.loop.stop();
  }

  async runOnce(): Promise<T> {
    return await this.loop.runOnce();
  }
}

async function waitForPromiseOrTimeout(
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      promise.then(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, Math.max(0, timeoutMs));
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
