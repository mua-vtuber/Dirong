import assert from "node:assert/strict";
import test from "node:test";
import {
  CREATABLE_NOTION_SCHEMA_LOCALES,
  DEFAULT_AI_CLEANUP_SETTINGS,
  DEFAULT_DASHBOARD_SETTINGS,
  DEFAULT_MEETING_NOTES_LANGUAGE,
  DEFAULT_NOTION_SETTINGS,
  DEFAULT_RECORDING_SETTINGS,
  DEFAULT_RETENTION_SETTINGS,
  DEFAULT_SETUP_AI_SETTINGS,
  DEFAULT_STT_SETTINGS,
  LOCAL_ONLY_DASHBOARD_HOST,
  SUPPORTED_STT_SAFE_FORMATS,
} from "./defaults.js";

test("product defaults snapshot matches the current effective defaults", () => {
  assert.deepEqual(DEFAULT_RECORDING_SETTINGS, {
    dataDir: "./data/sessions",
    dbBusyTimeoutMs: 5000,
    silenceMs: 1000,
    softRolloverMs: 60000,
    maxChunkMs: 120000,
    sttSafeFormat: "webm",
    sttMaxAttempts: 3,
    sttLeaseMs: 900000,
    partRepairAgeMs: 300000,
    enableDave: true,
    decryptionFailureTolerance: 24,
    envDebugVoice: true,
    productDebugVoice: false,
    envAutoRegisterCommands: true,
    envAloneFinalizeEnabled: false,
    productAloneFinalizeEnabled: true,
    aloneFinalizeGraceMs: 90000,
  });
  assert.deepEqual(DEFAULT_STT_SETTINGS, {
    provider: "local-whisper",
    language: "ko",
    timeoutMs: 120000,
    openai: {
      apiKey: "",
      model: "gpt-4o-mini-transcribe",
    },
    localWhisper: {
      profile: "local-whisper-python-script",
      command: "python",
      args: ["scripts/local-whisper-json.py"],
      model: "small",
      device: "cpu",
      computeType: "int8",
    },
  });
  assert.deepEqual(DEFAULT_AI_CLEANUP_SETTINGS, {
    claudeCommand: "claude",
    claudeModel: null,
    prepareTimeoutMs: 5000,
    autoCleanupEnabled: true,
    autoCleanupPollMs: 5000,
    autoCleanupSessionBatchLimit: 3,
    readinessRetryMs: 60000,
    leaseMs: null,
    maxAttempts: 3,
    maxInputChars: 120000,
    timeoutMs: 120000,
    maxOutputBytes: 2 * 1024 * 1024,
  });
  assert.deepEqual(DEFAULT_NOTION_SETTINGS, {
    enabled: false,
    apiKey: null,
    apiVersion: "2026-03-11",
    baseUrl: "https://api.notion.com",
    requestTimeoutMs: 30000,
    targetUrl: null,
    targetType: "data_source",
    uploadMode: "manual",
    templateType: "app",
    includeTranscript: "never",
    autoPollMs: 5000,
    leaseMs: 600000,
    maxAttempts: 3,
    propertyNames: {
      title: "Name",
      date: "Date",
      meetingTime: "Meeting Time",
      channel: "Channel",
      participants: "Participants",
      status: "Status",
      sessionId: "Session ID",
      draftId: "Draft ID",
      contentHash: "Dirong Content Hash",
      localStatus: "Local Status",
    },
  });
  assert.deepEqual(DEFAULT_RETENTION_SETTINGS, {
    deleteAudioAfterNotionUpload: true,
    textDraftRetentionDays: 30,
  });
  assert.deepEqual(DEFAULT_DASHBOARD_SETTINGS, {
    locale: "ko",
    theme: "system",
    themes: ["system", "light", "dark"],
    host: "127.0.0.1",
    port: 3095,
    openDashboard: true,
  });
});

test("policy defaults are named constants", () => {
  assert.equal(LOCAL_ONLY_DASHBOARD_HOST, "127.0.0.1");
  assert.deepEqual(SUPPORTED_STT_SAFE_FORMATS, ["webm", "wav"]);
  assert.equal(DEFAULT_MEETING_NOTES_LANGUAGE, "ko");
  assert.deepEqual(CREATABLE_NOTION_SCHEMA_LOCALES, ["ko"]);
  assert.deepEqual(DEFAULT_SETUP_AI_SETTINGS, {
    provider: "claude",
    mode: "cli",
    claudeProfile: "claude-cli-default",
    model: null,
  });
});
