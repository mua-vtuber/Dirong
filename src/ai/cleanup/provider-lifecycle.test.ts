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
  AiCleanupProviderLifecycleAdapter,
  wrapAiCleanupProviderWithLifecycle,
} from "./provider-lifecycle.js";

test("AiCleanupProviderLifecycleAdapter prepares a successful Claude CLI provider", async () => {
  const provider = new DeterministicCleanupProvider("success");
  const lifecycle = new AiCleanupProviderLifecycleAdapter(provider);

  assert.equal(lifecycle.providerName, "claude-cli");
  assert.equal(lifecycle.modelName, "haiku");
  assert.equal(lifecycle.capabilities.supportsWarmSession, false);
  assert.equal(lifecycle.capabilities.supportsJsonSchema, true);
  assert.equal(lifecycle.capabilities.readinessKind, "cli-auth");
  assert.equal(lifecycle.getReadiness().status, "idle");
  assert.equal(lifecycle.getReadiness().checkedAt, null);

  const readiness = await lifecycle.prepare({ timeoutMs: 100 });

  assert.equal(provider.preflightCalls, 1);
  assert.equal(readiness.status, "ready");
  assert.equal(readiness.message, "AI 준비 완료");
  assert.equal(readiness.userAction, null);
  assert.match(readiness.checkedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
});

test("AiCleanupProviderLifecycleAdapter maps missing Claude CLI to not_installed", async () => {
  const provider = new DeterministicCleanupProvider("missing");
  const lifecycle = wrapAiCleanupProviderWithLifecycle(provider);

  const readiness = await lifecycle.prepare({ timeoutMs: 100 });

  assert.equal(provider.preflightCalls, 1);
  assert.equal(readiness.status, "not_installed");
  assert.equal(readiness.message, "AI 도구를 찾지 못함");
  assert.match(readiness.userAction ?? "", /AI CLI/);
  assert.match(readiness.technicalDetail ?? "", /claude command missing/);
  assert.deepEqual(lifecycle.getReadiness(), readiness);
});

test("AiCleanupProviderLifecycleAdapter maps Claude CLI preflight failure to failed", async () => {
  const provider = new DeterministicCleanupProvider("failed");
  const lifecycle = new AiCleanupProviderLifecycleAdapter(provider);

  const readiness = await lifecycle.prepare({ timeoutMs: 100 });

  assert.equal(provider.preflightCalls, 1);
  assert.equal(readiness.status, "failed");
  assert.match(readiness.message, /녹음\/STT는 보존/);
  assert.match(readiness.technicalDetail ?? "", /unexpected preflight failure/);
});

test("AiCleanupProviderLifecycleAdapter leaves timeout and cancel surfaces open", async () => {
  const timeoutProvider = new DeterministicCleanupProvider("never");
  const timeoutLifecycle = new AiCleanupProviderLifecycleAdapter(timeoutProvider);

  const timedOut = await timeoutLifecycle.prepare({ timeoutMs: 1 });

  assert.equal(timeoutProvider.preflightCalls, 1);
  assert.equal(timedOut.status, "failed");
  assert.match(timedOut.technicalDetail ?? "", /timed out/);

  const cancelledProvider = new DeterministicCleanupProvider("success");
  const cancelledLifecycle = new AiCleanupProviderLifecycleAdapter(cancelledProvider);
  const controller = new AbortController();
  controller.abort();

  const cancelled = await cancelledLifecycle.prepare({ signal: controller.signal });

  assert.equal(cancelledProvider.preflightCalls, 0);
  assert.equal(cancelled.status, "failed");
  assert.match(cancelled.technicalDetail ?? "", /cancelled/);
});

test("AiCleanupProviderLifecycleAdapter delegates meeting note generation unchanged", async () => {
  const provider = new DeterministicCleanupProvider("success");
  const lifecycle = new AiCleanupProviderLifecycleAdapter(provider);
  const input = createProviderInput();
  const options = createProviderOptions();

  const result = await lifecycle.generateMeetingNotes(input, options, {
    timeoutMs: 100,
  });

  assert.equal(provider.generateCalls, 1);
  assert.equal(provider.lastInput, input);
  assert.equal(provider.lastOptions, options);
  assert.equal(result.provider, "claude-cli");
  assert.equal(result.model, "haiku");
  assert.equal(result.rawText, '{"ok":true}');
});

test("AiCleanupProviderLifecycleAdapter stop marks the runtime snapshot stopped", async () => {
  const provider = new DeterministicCleanupProvider("success");
  const lifecycle = new AiCleanupProviderLifecycleAdapter(provider);

  await lifecycle.prepare({ timeoutMs: 100 });
  await lifecycle.resetAfterRequest("success", { timeoutMs: 100 });
  await lifecycle.stop({ timeoutMs: 100 });

  const readiness = lifecycle.getReadiness();
  assert.equal(readiness.status, "stopped");
  assert.equal(readiness.message, "AI 준비 상태 확인 중지됨");
});

type PreflightBehavior = "success" | "missing" | "failed" | "never";

class DeterministicCleanupProvider implements AiCleanupProvider {
  readonly providerName = "claude-cli";
  readonly modelName = "haiku";
  readonly supportsJsonSchema = true;
  preflightCalls = 0;
  generateCalls = 0;
  lastInput: AiCleanupProviderInput | null = null;
  lastOptions: AiCleanupProviderOptions | null = null;

  constructor(private readonly preflightBehavior: PreflightBehavior) {}

  async preflight(): Promise<void> {
    this.preflightCalls += 1;
    if (this.preflightBehavior === "missing") {
      throw new AiCleanupProviderError(
        "provider_not_found",
        "claude command missing",
      );
    }
    if (this.preflightBehavior === "failed") {
      throw new Error("unexpected preflight failure");
    }
    if (this.preflightBehavior === "never") {
      await new Promise<void>(() => undefined);
    }
  }

  async generate(
    input: AiCleanupProviderInput,
    options: AiCleanupProviderOptions,
  ): Promise<AiCleanupProviderResult> {
    this.generateCalls += 1;
    this.lastInput = input;
    this.lastOptions = options;
    return {
      provider: this.providerName,
      model: this.modelName,
      commandDisplay: "claude --print [redacted-long-arg]",
      rawText: '{"ok":true}',
      stderrText: "",
      exitCode: 0,
      durationMs: 1,
    };
  }
}

function createProviderInput(): AiCleanupProviderInput {
  return {
    sessionId: "meeting_test",
    language: "ko",
    promptVersion: "phase4-ai-cleanup-v2",
    outputSchemaVersion: "dirong.meeting_notes_draft.v1",
    timeline: {
      contractVersion: "phase3.5-transcript-timeline-v1",
      sessionId: "meeting_test",
      includeNoSpeech: false,
      includeFakeStt: false,
      entries: [],
    },
    timelineMarkdown: "",
    inputHash: "hash",
  };
}

function createProviderOptions(): AiCleanupProviderOptions {
  return {
    timeoutMs: 1000,
    maxOutputBytes: 1000,
    systemPrompt: "system",
    userPrompt: "user",
    jsonSchema: {},
  };
}
