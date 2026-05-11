import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SPEAKER_SNAPSHOT_CACHE_LIMIT,
  upsertSpeakerSnapshot,
  type SpeakerSnapshot,
} from "./recording-producer.js";

test("speaker snapshot cache never grows beyond its cap", () => {
  const cache = new Map<string, SpeakerSnapshot>();

  for (let index = 0; index < DEFAULT_SPEAKER_SNAPSHOT_CACHE_LIMIT + 5; index += 1) {
    upsertSpeakerSnapshot(cache, `user-${index}`, {
      displayName: `User ${index}`,
      isBot: false,
    });
  }

  assert.equal(cache.size, DEFAULT_SPEAKER_SNAPSHOT_CACHE_LIMIT);
  assert.equal(cache.has("user-0"), false);
  assert.equal(cache.has(`user-${DEFAULT_SPEAKER_SNAPSHOT_CACHE_LIMIT + 4}`), true);
});

test("speaker snapshot cache refreshes existing entries as most recent", () => {
  const cache = new Map<string, SpeakerSnapshot>();
  upsertSpeakerSnapshot(cache, "a", { displayName: "A", isBot: false }, 2);
  upsertSpeakerSnapshot(cache, "b", { displayName: "B", isBot: false }, 2);
  upsertSpeakerSnapshot(cache, "a", { displayName: "A2", isBot: false }, 2);
  upsertSpeakerSnapshot(cache, "c", { displayName: "C", isBot: false }, 2);

  assert.deepEqual([...cache.keys()], ["a", "c"]);
  assert.equal(cache.get("a")?.displayName, "A2");
});
