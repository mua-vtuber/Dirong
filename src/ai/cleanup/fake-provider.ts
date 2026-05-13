import {
  MEETING_NOTES_DRAFT_SCHEMA_VERSION,
  type MeetingNotesDraftV1,
  type TimelineReference,
} from "./draft.js";
import type {
  AiCleanupProvider,
  AiCleanupProviderInput,
  AiCleanupProviderOptions,
  AiCleanupProviderResult,
} from "./provider.js";

export class FakeAiCleanupProvider implements AiCleanupProvider {
  readonly providerName: string = "fake";
  readonly modelName: string = "fake-meeting-notes-v1";
  readonly supportsJsonSchema = true;

  async preflight(): Promise<void> {
    return;
  }

  async generate(
    input: AiCleanupProviderInput,
    _options: AiCleanupProviderOptions,
  ): Promise<AiCleanupProviderResult> {
    const startedAt = Date.now();
    const draft = buildFakeDraft(input);
    return {
      provider: this.providerName,
      model: this.modelName,
      commandDisplay: null,
      rawText: JSON.stringify(draft),
      stderrText: "",
      exitCode: 0,
      durationMs: Date.now() - startedAt,
    };
  }
}

export class MalformedJsonAiCleanupProvider extends FakeAiCleanupProvider {
  override readonly modelName = "fake-malformed-json";

  override async generate(
    _input: AiCleanupProviderInput,
    _options: AiCleanupProviderOptions,
  ): Promise<AiCleanupProviderResult> {
    return {
      provider: this.providerName,
      model: this.modelName,
      commandDisplay: null,
      rawText: "{ this is not json",
      stderrText: "",
      exitCode: 0,
      durationMs: 0,
    };
  }
}

export class InvalidSchemaAiCleanupProvider extends FakeAiCleanupProvider {
  override readonly modelName = "fake-invalid-schema";

  override async generate(
    input: AiCleanupProviderInput,
    _options: AiCleanupProviderOptions,
  ): Promise<AiCleanupProviderResult> {
    return {
      provider: this.providerName,
      model: this.modelName,
      commandDisplay: null,
      rawText: JSON.stringify({
        schemaVersion: "wrong",
        sessionId: input.sessionId,
        markdown: "invalid",
      }),
      stderrText: "",
      exitCode: 0,
      durationMs: 0,
    };
  }
}

export class RepairingInvalidSchemaAiCleanupProvider extends FakeAiCleanupProvider {
  override readonly modelName = "fake-invalid-schema-repair";
  private callCount = 0;

  override async generate(
    input: AiCleanupProviderInput,
    options: AiCleanupProviderOptions,
  ): Promise<AiCleanupProviderResult> {
    this.callCount += 1;
    if (this.callCount === 1) {
      return {
        provider: this.providerName,
        model: this.modelName,
        commandDisplay: null,
        rawText: JSON.stringify({
          schemaVersion: "wrong",
          sessionId: input.sessionId,
          markdown: "invalid",
        }),
        stderrText: "",
        exitCode: 0,
        durationMs: 0,
      };
    }

    return super.generate(input, options);
  }
}

function buildFakeDraft(input: AiCleanupProviderInput): MeetingNotesDraftV1 {
  const first = input.timeline.entries[0];
  if (!first) {
    throw new Error("fake AI cleanup provider requires at least one timeline entry");
  }

  const reference: TimelineReference = {
    chunkId: first.chunkId,
    sttJobId: first.sttJobId,
    startMs: first.startMs,
    endMs: first.endMs,
    speaker: first.displayNameSnapshot,
  };
  const text = fakeDraftText(input.language, input.sessionId, input.timeline.entries.length);

  return {
    schemaVersion: MEETING_NOTES_DRAFT_SCHEMA_VERSION,
    language: input.language,
    sessionId: input.sessionId,
    sourceTimeline: {
      contractVersion: input.timeline.contractVersion,
      inputHash: input.inputHash,
      entryCount: input.timeline.entries.length,
    },
    meetingTitle: {
      text: text.title,
      confidence: "low",
      references: [reference],
    },
    summary: {
      text: text.summary,
      references: [reference],
    },
    topics: [
      {
        id: "topic_1",
        title: text.topicTitle,
        summary: first.text,
        references: [reference],
      },
    ],
    decisions: [],
    actionItems: [],
    unresolvedItems: [],
    uncertaintyNotes: [],
    noiseHandling: {
      removedChatterSummary: text.removedChatterSummary,
      keptBecause: [text.keptBecause],
    },
    notionProperties: {},
  };
}

function fakeDraftText(
  language: AiCleanupProviderInput["language"],
  sessionId: string,
  entryCount: number,
): {
  title: string;
  summary: string;
  topicTitle: string;
  removedChatterSummary: string;
  keptBecause: string;
} {
  if (language === "en") {
    return {
      title: `Meeting notes draft: ${sessionId}`,
      summary: `Fake meeting notes draft generated from ${entryCount} transcript entries.`,
      topicTitle: "Meeting content",
      removedChatterSummary: "The fake provider did not remove real chatter.",
      keptBecause: "Deterministic draft for offline verification.",
    };
  }
  return {
    title: `회의록 초안: ${sessionId}`,
    summary: `총 ${entryCount}개의 transcript entry를 바탕으로 생성한 fake 회의록 초안입니다.`,
    topicTitle: "회의 내용",
    removedChatterSummary: "Fake provider는 실제 잡담 제거를 수행하지 않았습니다.",
    keptBecause: "오프라인 검증용 deterministic draft입니다.",
  };
}
