import assert from "node:assert/strict";
import test from "node:test";
import type { SttSettings } from "../settings/app-settings.js";
import {
  assertPhase3SttProviderReady,
  createPhase3SttProvider,
} from "./provider-factory.js";

const localSettings: SttSettings = {
  provider: "local-whisper",
  language: "ko",
  timeoutMs: 120000,
  localWhisper: {
    command: "python",
    args: ["scripts/local-whisper-json.py"],
    model: "small",
    device: "cpu",
    computeType: "int8",
  },
};

test("createPhase3SttProvider creates local-whisper by default settings", () => {
  const selection = createPhase3SttProvider(localSettings);

  assert.equal(selection.settings.provider, "local-whisper");
  assert.equal(selection.provider.providerName, "local-whisper");
  assert.equal(selection.provider.modelName, "small");
});

test("createPhase3SttProvider can override provider to openai", () => {
  const selection = createPhase3SttProvider(localSettings, {
    provider: "openai",
    model: "whisper-1",
  });

  assert.equal(selection.settings.provider, "openai");
  assert.equal(selection.provider.providerName, "openai");
  assert.equal(selection.provider.modelName, "whisper-1");
});

test("assertPhase3SttProviderReady requires OpenAI key only for real OpenAI runs", () => {
  const openAiNoKey = createPhase3SttProvider(localSettings, {
    provider: "openai",
  }).settings;

  assert.doesNotThrow(() => {
    assertPhase3SttProviderReady({ settings: localSettings, dryRun: false });
  });
  assert.doesNotThrow(() => {
    assertPhase3SttProviderReady({ settings: openAiNoKey, dryRun: true });
  });
  assert.throws(() => {
    assertPhase3SttProviderReady({ settings: openAiNoKey, dryRun: false });
  }, /OPENAI_API_KEY/);
});
