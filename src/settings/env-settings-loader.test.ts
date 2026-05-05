import assert from "node:assert/strict";
import test from "node:test";
import { loadSttSettingsFromEnv, splitCommandArgs } from "./env-settings-loader.js";

test("loadSttSettingsFromEnv defaults to local-whisper", () => {
  const settings = loadSttSettingsFromEnv({} as NodeJS.ProcessEnv);

  assert.equal(settings.provider, "local-whisper");
  assert.equal(settings.language, "ko");
  assert.equal(settings.timeoutMs, 120000);
  assert.equal(settings.localWhisper.command, "python");
  assert.deepEqual(settings.localWhisper.args, ["scripts/local-whisper-json.py"]);
  assert.equal(settings.localWhisper.model, "small");
  assert.equal(settings.localWhisper.device, "cpu");
  assert.equal(settings.localWhisper.computeType, "int8");
});

test("loadSttSettingsFromEnv loads openai settings only when selected", () => {
  const settings = loadSttSettingsFromEnv({
    PHASE3_STT_PROVIDER: "openai",
    OPENAI_API_KEY: "test-key",
    PHASE3_STT_MODEL: "whisper-1",
    PHASE3_STT_LANGUAGE: "ko",
    PHASE3_STT_TIMEOUT_MS: "30000",
  } as NodeJS.ProcessEnv);

  assert.equal(settings.provider, "openai");
  assert.equal(settings.openai.apiKey, "test-key");
  assert.equal(settings.openai.model, "whisper-1");
  assert.equal(settings.timeoutMs, 30000);
});

test("splitCommandArgs keeps quoted paths together", () => {
  assert.deepEqual(
    splitCommandArgs('python-wrapper "--with space/script.py" --flag'),
    ["python-wrapper", "--with space/script.py", "--flag"],
  );
});
