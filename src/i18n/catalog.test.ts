import assert from "node:assert/strict";
import test from "node:test";
import { catalogs, listLocaleKeys, t } from "./catalog.js";

test("locale catalogs expose the same key structure", () => {
  assert.deepEqual(listLocaleKeys(catalogs.en), listLocaleKeys(catalogs.ko));
});

test("t resolves locale text and falls back to Korean when locale is missing", () => {
  assert.equal(
    t("en", "setup.discord.status.notConfigured.message"),
    "Discord bot connection setup is not complete yet.",
  );
  assert.equal(
    t(undefined, "setup.discord.status.notConfigured.message"),
    "Discord 봇 연결 설정이 아직 완료되지 않았습니다.",
  );
});

test("setup wizard exposes localized Discord onboarding copy", () => {
  assert.equal(
    t("ko", "dashboard.setupWizard.discord.description"),
    "Discord Developer Portal(디스코드 개발자 페이지)에서 만든 애플리케이션 ID와 봇 토큰을 저장합니다. 토큰은 저장 후 다시 표시하지 않습니다.",
  );
  assert.equal(
    t("ko", "dashboard.setupWizard.discord.guide.applicationIdStep6"),
    "디롱이 페이지로 돌아와 디스코드 애플리케이션 ID 칸에 붙여넣고 저장합니다.",
  );
  assert.equal(
    t("en", "dashboard.setupWizard.discord.guide.botTokenStep5"),
    "Return to Dirong, paste it into the Discord bot token field, and save it.",
  );
  assert.equal(
    t("ko", "dashboard.setupWizard.discord.connectionCheck.verifiedDescription"),
    "같은 디스코드 봇의 값인 것을 확인하였습니다. 다음으로 넘어가시면 됩니다.",
  );
  assert.match(
    t("ko", "dashboard.setupWizard.language.korean.description"),
    /디스코드 음성 채팅방에서 진행한 회의를 노션에 자동으로 등록/,
  );
});

test("setup wizard exposes updated Notion token guide copy", () => {
  assert.equal(
    t("ko", "dashboard.setupWizard.notionToken.guide.profileLink"),
    "Notion Developers",
  );
  assert.equal(
    t("ko", "dashboard.setupWizard.notionToken.guide.step3"),
    "연결 만들기에서 + 신규 연결 버튼을 클릭합니다.",
  );
  assert.equal(
    t("ko", "dashboard.setupWizard.notionToken.guide.step7"),
    "액세스 토큰 칸의 복사 버튼을 클릭합니다.",
  );
  assert.equal(
    t("en", "dashboard.setupWizard.notionToken.guide.step3"),
    "Under Create a connection, click + New connection.",
  );
});

test("dashboard settings exposes localized credit copy", () => {
  assert.equal(t("ko", "dashboard.settings.credits.title"), "정보");
  assert.equal(t("ko", "dashboard.settings.credits.directorLabel"), "감독");
  assert.equal(
    t("ko", "dashboard.settings.credits.githubUrl"),
    "https://github.com/mua-vtuber/Agestra",
  );
  assert.equal(t("en", "dashboard.settings.credits.title"), "About");
  assert.equal(t("en", "dashboard.settings.credits.madeWith"), "Built with Claude Code");
});
