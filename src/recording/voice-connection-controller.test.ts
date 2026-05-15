import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { VoiceConnection } from "@discordjs/voice";
import type { FlatStorageStore } from "../storage/storage-context.js";
import { VoiceConnectionController } from "./voice-connection-controller.js";

test("VoiceConnectionController detaches receiver and connection listeners", () => {
  const speaking = new EventEmitter();
  const connection = Object.assign(new EventEmitter(), {
    receiver: { speaking },
  }) as unknown as VoiceConnection;
  const events: string[] = [];
  const store = {
    recordConnectionEvent(input: { eventType: string }) {
      events.push(input.eventType);
    },
    updateSessionStatus() {},
  } as unknown as FlatStorageStore;
  const controller = new VoiceConnectionController(store);
  let speakingStarts = 0;

  controller.attach(
    {
      sessionId: "session-1",
      startedAtMs: Date.now(),
      connection,
      fatalErrors: 0,
      lastDisconnectedAt: null,
    },
    {
      onSpeakingStart() {
        speakingStarts += 1;
      },
    },
  );

  assert.equal(speaking.listenerCount("start"), 1);
  assert.equal(speaking.listenerCount("end"), 1);
  assert.equal(connection.listenerCount("stateChange"), 1);
  assert.equal(connection.listenerCount("debug"), 1);
  assert.equal(connection.listenerCount("error"), 1);

  speaking.emit("start", "user-1");
  assert.equal(speakingStarts, 1);
  assert.deepEqual(events, ["speaking_start"]);

  controller.detach();
  assert.equal(speaking.listenerCount("start"), 0);
  assert.equal(speaking.listenerCount("end"), 0);
  assert.equal(connection.listenerCount("stateChange"), 0);
  assert.equal(connection.listenerCount("debug"), 0);
  assert.equal(connection.listenerCount("error"), 0);

  speaking.emit("start", "user-2");
  connection.emit("debug", "after detach");
  assert.equal(speakingStarts, 1);
  assert.deepEqual(events, ["speaking_start"]);
});
