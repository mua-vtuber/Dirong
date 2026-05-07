export type PollingLoopTimer = ReturnType<typeof setTimeout> & {
  unref?: () => void;
};

export type PollingLoopOptions<T> = {
  intervalMs: number;
  runTick: () => Promise<T>;
  onScheduledError?: (error: unknown) => void | Promise<void>;
  setTimeout?: (callback: () => void, delayMs: number) => PollingLoopTimer;
  clearTimeout?: (timer: PollingLoopTimer) => void;
};

export class PollingLoop<T> {
  private timer: PollingLoopTimer | null = null;
  private tickPromise: Promise<T> | null = null;
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
    if (this.tickPromise) {
      await this.tickPromise;
    }
  }

  async runOnce(): Promise<T> {
    if (this.tickPromise) {
      return await this.tickPromise;
    }

    this.tickPromise = this.options.runTick();
    try {
      return await this.tickPromise;
    } finally {
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
