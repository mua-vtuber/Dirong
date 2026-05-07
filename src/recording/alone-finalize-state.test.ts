import assert from "node:assert/strict";
import test from "node:test";
import {
  createInitialAloneFinalizeSnapshot,
  reduceAloneFinalizeSnapshot,
  withDynamicAloneFinalizeCountdown,
} from "./alone-finalize-state.js";

test("Alone finalize reducer creates and updates full countdown snapshots", () => {
  const initial = createInitialAloneFinalizeSnapshot(true);

  assert.deepEqual(initial, {
    enabled: true,
    status: "idle",
    checkedAt: null,
    sessionId: null,
    voiceChannelId: null,
    aloneSince: null,
    finalizeAt: null,
    remainingMs: null,
    nonBotMemberCount: null,
    message: "혼자 남음 자동 종료 대기 중",
    userAction: null,
    technicalDetail: null,
    warnings: [],
  });

  const countdown = reduceAloneFinalizeSnapshot(initial, {
    type: "countdown_started",
    checkedAt: "2026-05-06T00:00:00.000Z",
    sessionId: "meeting_1",
    voiceChannelId: "voice_1",
    aloneSince: "2026-05-06T00:00:00.000Z",
    finalizeAt: "2026-05-06T00:00:05.000Z",
    remainingMs: 5000,
  });

  assert.deepEqual(countdown, {
    enabled: true,
    status: "countdown",
    checkedAt: "2026-05-06T00:00:00.000Z",
    sessionId: "meeting_1",
    voiceChannelId: "voice_1",
    aloneSince: "2026-05-06T00:00:00.000Z",
    finalizeAt: "2026-05-06T00:00:05.000Z",
    remainingMs: 5000,
    nonBotMemberCount: 0,
    message: "혼자 남음 감지, 5초 후 자동 종료",
    userAction: "grace 시간 안에 사람이 돌아오면 자동 종료가 취소됩니다.",
    technicalDetail: null,
    warnings: [],
  });

  assert.deepEqual(
    withDynamicAloneFinalizeCountdown(
      countdown,
      {
        sessionId: "meeting_1",
        voiceChannelId: "voice_1",
        aloneSinceMs: 1000,
        finalizeAtMs: 6000,
      },
      2500,
    ),
    {
      ...countdown,
      remainingMs: 3500,
      message: "혼자 남음 감지, 4초 후 자동 종료",
    },
  );
});

test("Alone finalize reducer keeps side-effect-free terminal snapshots", () => {
  const initial = createInitialAloneFinalizeSnapshot(true);
  const triggering = reduceAloneFinalizeSnapshot(initial, {
    type: "triggering",
    checkedAt: "2026-05-06T00:00:05.000Z",
    sessionId: "meeting_1",
    voiceChannelId: "voice_1",
  });
  const finalized = reduceAloneFinalizeSnapshot(triggering, {
    type: "finalized",
    checkedAt: "2026-05-06T00:00:06.000Z",
    sessionId: "meeting_1",
    voiceChannelId: "voice_1",
    resultStatus: "finalized",
  });

  assert.deepEqual(triggering, {
    enabled: true,
    status: "triggering",
    checkedAt: "2026-05-06T00:00:05.000Z",
    sessionId: "meeting_1",
    voiceChannelId: "voice_1",
    aloneSince: null,
    finalizeAt: null,
    remainingMs: null,
    nonBotMemberCount: 0,
    message: "혼자 남음 grace가 끝나 녹음을 자동 종료하는 중",
    userAction: null,
    technicalDetail: null,
    warnings: [],
  });
  assert.deepEqual(finalized, {
    ...triggering,
    status: "finalized",
    checkedAt: "2026-05-06T00:00:06.000Z",
    message: "혼자 남음으로 녹음을 자동 종료했습니다. 상태: finalized",
  });
});

test("Alone finalize reducer redacts failed technical details", () => {
  const failed = reduceAloneFinalizeSnapshot(
    createInitialAloneFinalizeSnapshot(true),
    {
      type: "failed",
      checkedAt: "2026-05-06T00:00:06.000Z",
      sessionId: "meeting_1",
      voiceChannelId: "voice_1",
      technicalDetail: "token=abc123",
    },
  );

  assert.deepEqual(failed, {
    enabled: true,
    status: "failed",
    checkedAt: "2026-05-06T00:00:06.000Z",
    sessionId: "meeting_1",
    voiceChannelId: "voice_1",
    aloneSince: null,
    finalizeAt: null,
    remainingMs: null,
    nonBotMemberCount: null,
    message: "혼자 남음 자동 종료 실패. 녹음/STT 데이터는 보존됩니다.",
    userAction: "dashboard와 로그를 확인한 뒤 필요하면 /dirong stop을 실행해 주세요.",
    technicalDetail: "token=[REDACTED]",
    warnings: ["alone_finalize_failed"],
  });
});
