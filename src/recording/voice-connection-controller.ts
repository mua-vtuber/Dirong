import {
  VoiceConnectionStatus,
  type VoiceConnection,
} from "@discordjs/voice";
import { extractDaveEvidence } from "../dave.js";
import { safeErrorInfo } from "../errors.js";
import type { VoiceConnectionControllerStore } from "./storage-port.js";

export type VoiceConnectionControllerSession = {
  sessionId: string;
  startedAtMs: number;
  connection: VoiceConnection;
  fatalErrors: number;
  lastDisconnectedAt: number | null;
};

export class VoiceConnectionController {
  private attached: {
    session: VoiceConnectionControllerSession;
    onStateChange: (oldState: { status: string }, newState: unknown) => void;
    onDebug: (message: string) => void;
    onError: (error: Error) => void;
    onSpeakingStart: (userId: string) => void;
    onSpeakingEnd: (userId: string) => void;
  } | null = null;

  constructor(private readonly store: VoiceConnectionControllerStore) {}

  attach(
    session: VoiceConnectionControllerSession,
    input: {
      onSpeakingStart(userId: string): void;
    },
  ): void {
    this.detach();

    const onSpeakingStart = (userId: string): void => {
      this.store.recordConnectionEvent({
        sessionId: session.sessionId,
        eventType: "speaking_start",
        startedAtMs: Date.now() - session.startedAtMs,
        details: { userId },
      });
      input.onSpeakingStart(userId);
    };

    const onSpeakingEnd = (userId: string): void => {
      this.store.recordConnectionEvent({
        sessionId: session.sessionId,
        eventType: "speaking_stop",
        endedAtMs: Date.now() - session.startedAtMs,
        details: { userId },
      });
    };

    const onStateChange = (
      oldState: { status: string },
      newState: unknown,
    ): void => {
      const newStatus =
        typeof (newState as { status?: unknown }).status === "string"
          ? (newState as { status: string }).status
          : "unknown";
      const evidence = extractDaveEvidence(newState);
      this.store.recordConnectionEvent({
        sessionId: session.sessionId,
        eventType: "voice_state_change",
        level: evidence.length > 0 ? "info" : "debug",
        startedAtMs: Date.now() - session.startedAtMs,
        details: {
          oldStatus: oldState.status,
          newStatus,
          daveEvidence: evidence,
        },
      });

      if (newStatus === VoiceConnectionStatus.Ready) {
        if (session.lastDisconnectedAt !== null) {
          this.store.updateSessionStatus(session.sessionId, "active");
          this.store.recordConnectionEvent({
            sessionId: session.sessionId,
            eventType: "connection_resumed",
            details: { gapMs: Date.now() - session.lastDisconnectedAt },
          });
          session.lastDisconnectedAt = null;
        } else {
          this.store.recordConnectionEvent({
            sessionId: session.sessionId,
            eventType: "connection_ready",
          });
        }
      }

      if (newStatus === VoiceConnectionStatus.Disconnected) {
        session.lastDisconnectedAt = Date.now();
        this.store.updateSessionStatus(session.sessionId, "reconnecting");
        this.store.recordConnectionEvent({
          sessionId: session.sessionId,
          eventType: "connection_disconnected",
          level: "warn",
          details: { reason: "VoiceConnectionStatus.Disconnected" },
        });
      }

      if (
        newStatus === VoiceConnectionStatus.Connecting ||
        newStatus === VoiceConnectionStatus.Signalling
      ) {
        this.store.recordConnectionEvent({
          sessionId: session.sessionId,
          eventType: "connection_reconnecting",
          details: { status: newStatus },
        });
      }
    };

    const onDebug = (message: string): void => {
      const isDave = /dave|encrypt|decrypt|protocol|session/i.test(message);
      this.store.recordConnectionEvent({
        sessionId: session.sessionId,
        eventType: isDave ? "voice_debug_dave_evidence" : "voice_debug",
        level: isDave ? "info" : "debug",
        details: { message },
      });
    };

    const onError = (error: Error): void => {
      session.fatalErrors += 1;
      this.store.recordConnectionEvent({
        sessionId: session.sessionId,
        eventType: "voice_connection_error",
        level: "error",
        details: safeErrorInfo(error),
      });
    };

    session.connection.receiver.speaking.on("start", onSpeakingStart);
    session.connection.receiver.speaking.on("end", onSpeakingEnd);
    session.connection.on("stateChange", onStateChange);
    session.connection.on("debug", onDebug);
    session.connection.on("error", onError);

    this.attached = {
      session,
      onStateChange,
      onDebug,
      onError,
      onSpeakingStart,
      onSpeakingEnd,
    };
  }

  detach(): void {
    if (!this.attached) {
      return;
    }

    const attached = this.attached;
    attached.session.connection.receiver.speaking.off(
      "start",
      attached.onSpeakingStart,
    );
    attached.session.connection.receiver.speaking.off(
      "end",
      attached.onSpeakingEnd,
    );
    attached.session.connection.off("stateChange", attached.onStateChange);
    attached.session.connection.off("debug", attached.onDebug);
    attached.session.connection.off("error", attached.onError);
    this.attached = null;
  }
}
