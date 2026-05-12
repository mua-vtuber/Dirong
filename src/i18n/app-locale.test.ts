import assert from "node:assert/strict";
import test from "node:test";
import { createAppLocaleResolver, resolveAppLocale } from "./app-locale.js";

test("resolveAppLocale reads settings app locale and falls back safely", () => {
  assert.equal(
    resolveAppLocale({
      settingsStore: {
        read: () => ({ app: { locale: "en" } }),
      },
    }),
    "en",
  );
  assert.equal(resolveAppLocale({ locale: "jp" }), "ko");
});

test("createAppLocaleResolver reads the latest locale each time", () => {
  let locale = "ko";
  const resolver = createAppLocaleResolver({ getLocale: () => locale });

  assert.equal(resolver(), "ko");
  locale = "en";
  assert.equal(resolver(), "en");
});
