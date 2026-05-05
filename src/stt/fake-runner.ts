import type { SessionStore } from "../storage/session-store.js";
import { FakeSttProvider } from "./provider.js";
import { runSttBatch, type SttRunResult } from "./runner.js";

export type FakeSttRunOptions = {
  workerId: string;
  limit: number;
  sessionId?: string | null;
  leaseMs: number;
  dryRun: boolean;
};

export type FakeSttRunResult = SttRunResult;

export async function runFakeSttBatch(
  store: SessionStore,
  options: FakeSttRunOptions,
): Promise<FakeSttRunResult> {
  return await runSttBatch(store, {
    ...options,
    source: "fake",
    provider: new FakeSttProvider(),
  });
}
