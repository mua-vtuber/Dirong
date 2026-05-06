import assert from "node:assert/strict";
import test from "node:test";
import { AiCleanupProviderError } from "./provider.js";
import type {
  AiCleanupProvider,
  AiCleanupProviderInput,
  AiCleanupProviderOptions,
  AiCleanupProviderResult,
} from "./provider.js";
import {
  AiProviderLifecycleService,
  formatAiReadinessForStatus,
} from "./provider-lifecycle-service.js";
import { wrapAiCleanupProviderWithLifecycle } from "./provider-lifecycle.js";

test("AiProviderLifecycleService returns a ready runtime snapshot after background prepare", async () => {
  const provider = new DeterministicCleanupProvider("success");
  const service = new AiProviderLifecycleService(
    wrapAiCleanupProviderWithLifecycle(provider),
    { prepareTimeoutMs: 100 },
  );

  assert.equal(service.getSnapshot().status, "idle");

  const prepare = service.startPrepareInBackground();
  assert.equal(service.getSnapshot().status, "preparing");

  const snapshot = await prepare;

  assert.equal(provider.preflightCalls, 1);
  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.message, "AI 준비 완료");
  assert.deepEqual(service.getSnapshot(), snapshot);
});

test("AiProviderLifecycleService keeps a failed readiness snapshot without throwing", async () => {
  const provider = new DeterministicCleanupProvider("missing");
  const service = new AiProviderLifecycleService(
    wrapAiCleanupProviderWithLifecycle(provider),
    { prepareTimeoutMs: 100 },
  );

  const snapshot = await service.startPrepareInBackground();

  assert.equal(provider.preflightCalls, 1);
  assert.equal(snapshot.status, "not_installed");
  assert.equal(snapshot.message, "AI 도구를 찾지 못함");
  assert.equal(service.getSnapshot().status, "not_installed");
});

test("AiProviderLifecycleService can retry prepare after a failed check", async () => {
  const provider = new DeterministicCleanupProvider("missing");
  const service = new AiProviderLifecycleService(
    wrapAiCleanupProviderWithLifecycle(provider),
    { prepareTimeoutMs: 100 },
  );

  const failed = await service.startPrepareInBackground();
  assert.equal(failed.status, "not_installed");

  provider.preflightBehavior = "success";
  const ready = await service.startPrepareInBackground();

  assert.equal(provider.preflightCalls, 2);
  assert.equal(ready.status, "ready");
  assert.equal(service.getSnapshot().status, "ready");
});

test("AiProviderLifecycleService stop publishes a stopped snapshot", async () => {
  const provider = new DeterministicCleanupProvider("success");
  const service = new AiProviderLifecycleService(
    wrapAiCleanupProviderWithLifecycle(provider),
    { prepareTimeoutMs: 100 },
  );

  await service.startPrepareInBackground();
  await service.stop();

  const snapshot = service.getSnapshot();
  assert.equal(snapshot.status, "stopped");
  assert.equal(snapshot.message, "AI 준비 상태 확인 중지됨");
});

test("formatAiReadinessForStatus renders user-facing status text", () => {
  assert.equal(
    formatAiReadinessForStatus({
      status: "login_required",
      provider: "claude-cli",
      model: "haiku",
      checkedAt: "2026-05-06T00:00:00.000Z",
      message: "AI 로그인 필요",
      userAction: "터미널에서 AI CLI 로그인을 완료한 뒤 다시 확인해 주세요.",
      technicalDetail: "hidden detail",
    }),
    [
      "AI 상태: AI 로그인 필요",
      "AI provider: claude-cli / haiku",
      "AI 조치: 터미널에서 AI CLI 로그인을 완료한 뒤 다시 확인해 주세요.",
    ].join("\n"),
  );
});

type PreflightBehavior = "success" | "missing";

class DeterministicCleanupProvider implements AiCleanupProvider {
  readonly providerName = "claude-cli";
  readonly modelName = "haiku";
  readonly supportsJsonSchema = true;
  preflightCalls = 0;

  constructor(public preflightBehavior: PreflightBehavior) {}

  async preflight(): Promise<void> {
    this.preflightCalls += 1;
    if (this.preflightBehavior === "missing") {
      throw new AiCleanupProviderError(
        "provider_not_found",
        "claude command missing",
      );
    }
  }

  async generate(
    _input: AiCleanupProviderInput,
    _options: AiCleanupProviderOptions,
  ): Promise<AiCleanupProviderResult> {
    return {
      provider: this.providerName,
      model: this.modelName,
      commandDisplay: null,
      rawText: "{}",
      stderrText: "",
      exitCode: 0,
      durationMs: 1,
    };
  }
}
