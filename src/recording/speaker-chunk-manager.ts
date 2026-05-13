import type {
  Client,
  Guild,
  GuildMember,
  VoiceBasedChannel,
} from "discord.js";
import { safeErrorInfo } from "../errors.js";
import type { SpeakerChunkStore } from "./storage-port.js";

export const DEFAULT_SPEAKER_SNAPSHOT_CACHE_LIMIT = 512;

export type SpeakerSnapshot = {
  displayName: string;
  isBot: boolean;
};

export type SpeakerChunkSession = {
  sessionId: string;
  guild: Guild;
  channel: VoiceBasedChannel;
  speakerSnapshots: Map<string, SpeakerSnapshot>;
};

export class SpeakerChunkManager {
  constructor(
    private readonly client: Client,
    private readonly store: SpeakerChunkStore,
  ) {}

  async resolveSpeakerSnapshot(
    active: SpeakerChunkSession,
    userId: string,
  ): Promise<SpeakerSnapshot> {
    const cached = active.speakerSnapshots.get(userId);
    if (cached) {
      upsertSpeakerSnapshot(active.speakerSnapshots, userId, cached);
      return cached;
    }

    const memberFromChannel = active.channel.members.get(userId);
    if (memberFromChannel) {
      return this.cacheSpeaker(active, userId, memberFromChannel);
    }

    try {
      const member = await active.guild.members.fetch(userId);
      return this.cacheSpeaker(active, userId, member);
    } catch {
      try {
        const user = await this.client.users.fetch(userId);
        const snapshot = {
          displayName: user.globalName ?? user.username ?? userId,
          isBot: user.bot,
        };
        upsertSpeakerSnapshot(active.speakerSnapshots, userId, snapshot);
        return snapshot;
      } catch (error) {
        this.store.recordConnectionEvent({
          sessionId: active.sessionId,
          eventType: "speaker_lookup_failed",
          level: "warn",
          details: { userId, error: safeErrorInfo(error) },
        });
        const snapshot = { displayName: userId, isBot: false };
        upsertSpeakerSnapshot(active.speakerSnapshots, userId, snapshot);
        return snapshot;
      }
    }
  }

  private cacheSpeaker(
    active: SpeakerChunkSession,
    userId: string,
    member: GuildMember,
  ): SpeakerSnapshot {
    const snapshot = {
      displayName: member.displayName || member.user.globalName || member.user.username,
      isBot: member.user.bot,
    };
    upsertSpeakerSnapshot(active.speakerSnapshots, userId, snapshot);
    return snapshot;
  }
}

export function upsertSpeakerSnapshot(
  cache: Map<string, SpeakerSnapshot>,
  userId: string,
  snapshot: SpeakerSnapshot,
  limit = DEFAULT_SPEAKER_SNAPSHOT_CACHE_LIMIT,
): void {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("Speaker snapshot cache limit must be a positive integer.");
  }
  cache.delete(userId);
  cache.set(userId, snapshot);
  while (cache.size > limit) {
    const oldestUserId = cache.keys().next().value;
    if (oldestUserId === undefined) {
      break;
    }
    cache.delete(oldestUserId);
  }
}
