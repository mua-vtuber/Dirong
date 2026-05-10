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
