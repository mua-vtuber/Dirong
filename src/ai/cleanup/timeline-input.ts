import { createHash } from "node:crypto";
import {
  buildPhase4TranscriptTimeline,
  renderPhase4TranscriptTimelineMarkdown,
  type Phase4TranscriptTimeline,
} from "../../transcript/timeline.js";
import type { AiCleanupTimelineStore } from "./storage-port.js";

export type Phase4TimelineInput = {
  timeline: Phase4TranscriptTimeline;
  canonicalJson: string;
  inputHash: string;
  markdown: string;
};

export function buildPhase4TimelineInput(
  store: AiCleanupTimelineStore,
  input: {
    sessionId: string;
    includeFakeStt?: boolean;
  },
): Phase4TimelineInput {
  const timeline = buildPhase4TranscriptTimeline(store, {
    sessionId: input.sessionId,
    includeNoSpeech: false,
    includeFakeStt: input.includeFakeStt ?? false,
  });
  const canonicalJson = stableStringify(timeline);

  return {
    timeline,
    canonicalJson,
    inputHash: sha256Text(canonicalJson),
    markdown: renderPhase4TranscriptTimelineMarkdown(timeline),
  };
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stabilize(value));
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stabilize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stabilize);
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    output[key] = stabilize((value as Record<string, unknown>)[key]);
  }
  return output;
}
