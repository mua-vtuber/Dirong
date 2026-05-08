import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DirongDatabase } from "../storage/sqlite.js";
import { SqlRunner } from "../storage/sql-runner.js";
import { DEFAULT_NOTION_PROPERTY_NAMES } from "./settings.js";
import {
  buildNotionCustomPropertyPrompt,
  NotionCustomPropertyRuleStore,
} from "./property-rules.js";

test("NotionCustomPropertyRuleStore syncs user properties and keeps required properties internal", () => {
  const fixture = createFixture();
  try {
    const store = new NotionCustomPropertyRuleStore(fixture.runner);

    const result = store.syncDataSourceProperties({
      properties: {
        Name: { id: "title", type: "title" },
        Date: { id: "date", type: "date" },
        Discussion: { id: "discussion", type: "rich_text" },
        planner_action: { id: "planner", type: "rich_text" },
      },
      requiredPropertyNames: DEFAULT_NOTION_PROPERTY_NAMES,
      nowIso: "2026-05-08T00:00:00.000Z",
    });

    assert.deepEqual(result, { discovered: 4, custom: 2 });
    assert.deepEqual(
      store.listRules().map((rule) => ({
        propertyName: rule.propertyName,
        propertyType: rule.propertyType,
        enabled: rule.enabled,
      })),
      [
        { propertyName: "Discussion", propertyType: "rich_text", enabled: false },
        {
          propertyName: "planner_action",
          propertyType: "rich_text",
          enabled: false,
        },
      ],
    );
  } finally {
    fixture.close();
  }
});

test("NotionCustomPropertyRuleStore saves bounded prompt descriptions", () => {
  const fixture = createFixture();
  try {
    const store = new NotionCustomPropertyRuleStore(fixture.runner);
    store.syncDataSourceProperties({
      properties: {
        Discussion: { id: "discussion", type: "rich_text" },
      },
      requiredPropertyNames: DEFAULT_NOTION_PROPERTY_NAMES,
      nowIso: "2026-05-08T00:00:00.000Z",
    });

    const saveResult = store.saveRules({
      rules: [
        {
          propertyName: "Discussion",
          enabled: true,
          promptDescription: "회의 논의 사항을 5줄 이내로 요약",
          maxLength: 5000,
        },
      ],
      requiredPropertyNames: DEFAULT_NOTION_PROPERTY_NAMES,
      nowIso: "2026-05-08T00:01:00.000Z",
    });

    assert.deepEqual(saveResult, { saved: 1, ignored: 0, warnings: [] });
    const [rule] = store.listEnabledRules();
    assert.equal(rule?.propertyName, "Discussion");
    assert.equal(rule?.maxLength, 2000);
    assert.match(
      buildNotionCustomPropertyPrompt(store.listEnabledRules()),
      /"Discussion" \(rich_text, max 2000 chars\): 회의 논의 사항/,
    );
  } finally {
    fixture.close();
  }
});

function createFixture(): {
  runner: SqlRunner;
  close: () => void;
} {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-notion-rules-"));
  const database = new DirongDatabase(path.join(dir, "dirong.sqlite"), 1000);
  return {
    runner: new SqlRunner(database),
    close: () => {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
