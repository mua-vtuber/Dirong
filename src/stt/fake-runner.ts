import { FakeSttProvider } from "./provider.js";
import { runSttBatch, type SttRunResult } from "./runner.js";
import type { SttBatchStore } from "./storage-port.js";

export type FakeSttRunOptions = {
  workerId: string;
  limit: number;
  sessionId?: string | null;
  leaseMs: number;
  dryRun: boolean;
};

export type FakeSttRunResult = SttRunResult;

export async function runFakeSttBatch(
  store: SttBatchStore,
  options: FakeSttRunOptions,
): Promise<FakeSttRunResult> {
  return await runSttBatch(store, {
    ...options,
    source: "fake",
    provider: new FakeSttProvider(),
  });
}
