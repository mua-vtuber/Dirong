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
  withDefaultNotionMemberRelationRule,
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
          propertyType: "rich_text",
          enabled: true,
          promptDescription: "회의 논의 사항을 5줄 이내로 요약",
          maxLength: 5000,
        },
      ],
      requiredPropertyNames: DEFAULT_NOTION_PROPERTY_NAMES,
      nowIso: "2026-05-08T00:01:00.000Z",
    });

    assert.deepEqual(saveResult, { saved: 1, deleted: 0, ignored: 0, warnings: [] });
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

test("NotionCustomPropertyRuleStore creates and deletes Korean local rules", () => {
  const fixture = createFixture();
  try {
    const store = new NotionCustomPropertyRuleStore(fixture.runner);

    assert.deepEqual(
      store.saveRules({
        rules: [
          {
            propertyName: "프로그래머 할 일",
            propertyType: "rich_text",
            enabled: true,
            promptDescription: "프로그래머가 해야 할 구현 작업만 정리",
            maxLength: 1200,
          },
        ],
        requiredPropertyNames: DEFAULT_NOTION_PROPERTY_NAMES,
        nowIso: "2026-05-08T00:00:00.000Z",
      }),
      { saved: 1, deleted: 0, ignored: 0, warnings: [] },
    );
    assert.equal(store.listEnabledRules()[0]?.propertyName, "프로그래머 할 일");

    assert.deepEqual(
      store.saveRules({
        rules: [
          {
            originalPropertyName: "프로그래머 할 일",
            propertyName: "프로그래머 할 일",
            propertyType: "rich_text",
            enabled: true,
            promptDescription: "",
            deleted: true,
          },
        ],
        requiredPropertyNames: DEFAULT_NOTION_PROPERTY_NAMES,
        nowIso: "2026-05-08T00:01:00.000Z",
      }),
      { saved: 0, deleted: 1, ignored: 0, warnings: [] },
    );
    assert.deepEqual(store.listRules(), []);
  } finally {
    fixture.close();
  }
});

test("NotionCustomPropertyRuleStore saves relation settings", () => {
  const fixture = createFixture();
  try {
    const store = new NotionCustomPropertyRuleStore(fixture.runner);

    const result = store.saveRules({
      rules: [
        {
          propertyName: "프로젝트",
          propertyType: "relation",
          enabled: true,
          promptDescription: "회의에서 언급된 프로젝트 이름",
          relationTargetUrl: "https://www.notion.so/example?v=123",
          relationTargetPageUrl:
            "https://www.notion.so/workspace/Project-Moonfall-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          relationMatchPropertyName: "Name",
          relationAutoCreate: true,
        },
      ],
      requiredPropertyNames: DEFAULT_NOTION_PROPERTY_NAMES,
      nowIso: "2026-05-08T00:00:00.000Z",
    });

    assert.deepEqual(result, { saved: 1, deleted: 0, ignored: 0, warnings: [] });
    const [rule] = store.listEnabledRules();
    assert.equal(rule?.propertyType, "relation");
    assert.equal(rule?.relationTargetUrl, "https://www.notion.so/example?v=123");
    assert.equal(
      rule?.relationTargetPageId,
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    );
    assert.equal(rule?.relationMatchPropertyName, "Name");
    assert.equal(rule?.relationAutoCreate, true);
    assert.equal(
      buildNotionCustomPropertyPrompt(store.listEnabledRules()),
      "",
    );
  } finally {
    fixture.close();
  }
});

test("NotionCustomPropertyRuleStore enables fixed relation page rules without a prompt", () => {
  const fixture = createFixture();
  try {
    const store = new NotionCustomPropertyRuleStore(fixture.runner);

    const result = store.saveRules({
      rules: [
        {
          propertyName: "프로젝트",
          propertyType: "relation",
          enabled: true,
          promptDescription: "",
          relationTargetPageUrl:
            "https://www.notion.so/workspace/Project-Moonfall-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
      ],
      requiredPropertyNames: DEFAULT_NOTION_PROPERTY_NAMES,
      nowIso: "2026-05-08T00:00:00.000Z",
    });

    assert.deepEqual(result, { saved: 1, deleted: 0, ignored: 0, warnings: [] });
    const [rule] = store.listEnabledRules();
    assert.equal(rule?.propertyName, "프로젝트");
    assert.equal(
      rule?.relationTargetPageId,
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    );
    assert.match(
      buildNotionCustomPropertyPrompt(store.listEnabledRules()),
      /^$/,
    );
  } finally {
    fixture.close();
  }
});

test("NotionCustomPropertyRuleStore enables participant-sourced relation rules without a prompt", () => {
  const fixture = createFixture();
  try {
    const store = new NotionCustomPropertyRuleStore(fixture.runner);

    const result = store.saveRules({
      rules: [
        {
          propertyName: "Members",
          propertyType: "relation",
          valueSource: "participants",
          enabled: true,
          promptDescription: "",
          relationTargetUrl: "https://www.notion.so/members",
          relationMatchPropertyName: "Name",
          relationAutoCreate: true,
        },
      ],
      requiredPropertyNames: DEFAULT_NOTION_PROPERTY_NAMES,
      nowIso: "2026-05-08T00:00:00.000Z",
    });

    assert.deepEqual(result, { saved: 1, deleted: 0, ignored: 0, warnings: [] });
    const [rule] = store.listEnabledRules();
    assert.equal(rule?.propertyName, "Members");
    assert.equal(rule?.valueSource, "participants");
    assert.equal(
      buildNotionCustomPropertyPrompt(store.listEnabledRules()),
      "",
    );
  } finally {
    fixture.close();
  }
});

test("default Members relation rule is present and protected", () => {
  const [rule] = withDefaultNotionMemberRelationRule([]);

  assert.equal(rule?.propertyName, "Members");
  assert.equal(rule?.propertyType, "relation");
  assert.equal(rule?.valueSource, "participants");
  assert.equal(rule?.protected, true);
  assert.equal(rule?.enabled, false);
});

test("NotionCustomPropertyRuleStore protects Members relation from delete and rename", () => {
  const fixture = createFixture();
  try {
    const store = new NotionCustomPropertyRuleStore(fixture.runner);

    store.saveRules({
      rules: [
        {
          propertyName: "Members",
          propertyType: "relation",
          valueSource: "participants",
          enabled: true,
          promptDescription: "",
          relationTargetUrl: "https://www.notion.so/members",
        },
      ],
      requiredPropertyNames: DEFAULT_NOTION_PROPERTY_NAMES,
      nowIso: "2026-05-08T00:00:00.000Z",
    });

    const renamed = store.saveRules({
      rules: [
        {
          originalPropertyName: "Members",
          propertyName: "People",
          propertyType: "rich_text",
          valueSource: "ai",
          enabled: true,
          promptDescription: "ignored",
        },
      ],
      requiredPropertyNames: DEFAULT_NOTION_PROPERTY_NAMES,
      nowIso: "2026-05-08T00:01:00.000Z",
    });
    assert.match(renamed.warnings.join("\n"), /이름은 바꿀 수 없습니다/);
    assert.equal(store.listRules()[0]?.propertyName, "Members");
    assert.equal(store.listRules()[0]?.propertyType, "relation");
    assert.equal(store.listRules()[0]?.valueSource, "participants");

    const deleted = store.saveRules({
      rules: [
        {
          originalPropertyName: "Members",
          propertyName: "Members",
          propertyType: "relation",
          enabled: true,
          promptDescription: "",
          deleted: true,
        },
      ],
      requiredPropertyNames: DEFAULT_NOTION_PROPERTY_NAMES,
      nowIso: "2026-05-08T00:02:00.000Z",
    });

    assert.equal(deleted.deleted, 0);
    assert.equal(deleted.ignored, 1);
    assert.match(deleted.warnings.join("\n"), /삭제할 수 없습니다/);
    assert.equal(store.listRules().length, 1);
  } finally {
    fixture.close();
  }
});

test("NotionCustomPropertyRuleStore syncs Members relation as participant source", () => {
  const fixture = createFixture();
  try {
    const store = new NotionCustomPropertyRuleStore(fixture.runner);

    store.syncDataSourceProperties({
      properties: {
        Members: {
          id: "members-id",
          type: "relation",
          relation: { data_source_id: "member-data-source" },
        },
      },
      requiredPropertyNames: DEFAULT_NOTION_PROPERTY_NAMES,
      nowIso: "2026-05-08T00:00:00.000Z",
    });

    const [rule] = store.listRules();
    assert.equal(rule?.propertyName, "Members");
    assert.equal(rule?.valueSource, "participants");
    assert.equal(rule?.protected, true);
    assert.equal(rule?.relationDataSourceId, "member-data-source");
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
