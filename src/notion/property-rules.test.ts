import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DirongDatabase } from "../storage/sqlite.js";
import { SqlRunner } from "../storage/sql-runner.js";
import { ProjectStore } from "../projects/project-store.js";
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
      databaseRole: "meeting",
      properties: {
        Name: { id: "title", type: "title" },
        Date: { id: "date", type: "date" },
        Discussion: { id: "discussion", type: "rich_text" },
        planner_action: { id: "planner", type: "rich_text" },
      },
      requiredPropertyNames: Object.values(DEFAULT_NOTION_PROPERTY_NAMES),
      nowIso: "2026-05-08T00:00:00.000Z",
    });

    assert.deepEqual(result, { discovered: 4, custom: 2 });
    assert.deepEqual(
      store.listRules("meeting").map((rule) => ({
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
      databaseRole: "meeting",
      properties: {
        Discussion: { id: "discussion", type: "rich_text" },
      },
      requiredPropertyNames: Object.values(DEFAULT_NOTION_PROPERTY_NAMES),
      nowIso: "2026-05-08T00:00:00.000Z",
    });

    const saveResult = store.saveRules({
      databaseRole: "meeting",
      rules: [
        {
          propertyName: "Discussion",
          propertyType: "rich_text",
          enabled: true,
          promptDescription: "회의 논의 사항을 5줄 이내로 요약",
          maxLength: 5000,
        },
      ],
      requiredPropertyNames: Object.values(DEFAULT_NOTION_PROPERTY_NAMES),
      nowIso: "2026-05-08T00:01:00.000Z",
    });

    assert.deepEqual(saveResult, { saved: 1, deleted: 0, ignored: 0, warnings: [] });
    const [rule] = store.listEnabledRules("meeting");
    assert.equal(rule?.propertyName, "Discussion");
    assert.equal(rule?.maxLength, 2000);
    assert.match(
      buildNotionCustomPropertyPrompt(store.listEnabledRules("meeting")),
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
        databaseRole: "meeting",
        rules: [
          {
            propertyName: "프로그래머 할 일",
            propertyType: "rich_text",
            enabled: true,
            promptDescription: "프로그래머가 해야 할 구현 작업만 정리",
            maxLength: 1200,
          },
        ],
        requiredPropertyNames: Object.values(DEFAULT_NOTION_PROPERTY_NAMES),
        nowIso: "2026-05-08T00:00:00.000Z",
      }),
      { saved: 1, deleted: 0, ignored: 0, warnings: [] },
    );
    assert.equal(
      store.listEnabledRules("meeting")[0]?.propertyName,
      "프로그래머 할 일",
    );

    assert.deepEqual(
      store.saveRules({
        databaseRole: "meeting",
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
        requiredPropertyNames: Object.values(DEFAULT_NOTION_PROPERTY_NAMES),
        nowIso: "2026-05-08T00:01:00.000Z",
      }),
      { saved: 0, deleted: 1, ignored: 0, warnings: [] },
    );
    assert.deepEqual(store.listRules("meeting"), []);
  } finally {
    fixture.close();
  }
});

test("NotionCustomPropertyRuleStore saves relation settings", () => {
  const fixture = createFixture();
  try {
    const store = new NotionCustomPropertyRuleStore(fixture.runner);

    const result = store.saveRules({
      databaseRole: "meeting",
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
      requiredPropertyNames: Object.values(DEFAULT_NOTION_PROPERTY_NAMES),
      nowIso: "2026-05-08T00:00:00.000Z",
    });

    assert.deepEqual(result, { saved: 1, deleted: 0, ignored: 0, warnings: [] });
    const [rule] = store.listEnabledRules("meeting");
    assert.equal(rule?.propertyType, "relation");
    assert.equal(rule?.relationTargetUrl, "https://www.notion.so/example?v=123");
    assert.equal(
      rule?.relationTargetPageId,
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    );
    assert.equal(rule?.relationMatchPropertyName, "Name");
    assert.equal(rule?.relationAutoCreate, true);
    assert.equal(
      buildNotionCustomPropertyPrompt(store.listEnabledRules("meeting")),
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
      databaseRole: "meeting",
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
      requiredPropertyNames: Object.values(DEFAULT_NOTION_PROPERTY_NAMES),
      nowIso: "2026-05-08T00:00:00.000Z",
    });

    assert.deepEqual(result, { saved: 1, deleted: 0, ignored: 0, warnings: [] });
    const [rule] = store.listEnabledRules("meeting");
    assert.equal(rule?.propertyName, "프로젝트");
    assert.equal(
      rule?.relationTargetPageId,
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    );
    assert.match(
      buildNotionCustomPropertyPrompt(store.listEnabledRules("meeting")),
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
      databaseRole: "meeting",
      rules: [
        {
          propertyName: "Attendees",
          propertyType: "relation",
          valueSource: "participants",
          enabled: true,
          promptDescription: "",
          relationTargetUrl: "https://www.notion.so/members",
          relationMatchPropertyName: "Name",
          relationAutoCreate: true,
        },
      ],
      requiredPropertyNames: Object.values(DEFAULT_NOTION_PROPERTY_NAMES),
      nowIso: "2026-05-08T00:00:00.000Z",
    });

    assert.deepEqual(result, { saved: 1, deleted: 0, ignored: 0, warnings: [] });
    const [rule] = store.listEnabledRules("meeting");
    assert.equal(rule?.propertyName, "Attendees");
    assert.equal(rule?.valueSource, "participants");
    assert.equal(
      buildNotionCustomPropertyPrompt(store.listEnabledRules("meeting")),
      "",
    );
  } finally {
    fixture.close();
  }
});

test("NotionCustomPropertyRuleStore treats Members as a normal custom rule", () => {
  const fixture = createFixture();
  try {
    const store = new NotionCustomPropertyRuleStore(fixture.runner);

    store.saveRules({
      databaseRole: "meeting",
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
      requiredPropertyNames: Object.values(DEFAULT_NOTION_PROPERTY_NAMES),
      nowIso: "2026-05-08T00:00:00.000Z",
    });

    const renamed = store.saveRules({
      databaseRole: "meeting",
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
      requiredPropertyNames: Object.values(DEFAULT_NOTION_PROPERTY_NAMES),
      nowIso: "2026-05-08T00:01:00.000Z",
    });
    assert.deepEqual(renamed, { saved: 1, deleted: 0, ignored: 0, warnings: [] });
    assert.equal(store.listRules("meeting")[0]?.propertyName, "People");
    assert.equal(store.listRules("meeting")[0]?.propertyType, "rich_text");
    assert.equal(store.listRules("meeting")[0]?.valueSource, "ai");

    const deleted = store.saveRules({
      databaseRole: "meeting",
      rules: [
        {
          originalPropertyName: "People",
          propertyName: "People",
          propertyType: "rich_text",
          enabled: true,
          promptDescription: "",
          deleted: true,
        },
      ],
      requiredPropertyNames: Object.values(DEFAULT_NOTION_PROPERTY_NAMES),
      nowIso: "2026-05-08T00:02:00.000Z",
    });

    assert.deepEqual(deleted, { saved: 0, deleted: 1, ignored: 0, warnings: [] });
    assert.equal(store.listRules("meeting").length, 0);
  } finally {
    fixture.close();
  }
});

test("NotionCustomPropertyRuleStore syncs Members as a regular AI-sourced property", () => {
  const fixture = createFixture();
  try {
    const store = new NotionCustomPropertyRuleStore(fixture.runner);

    store.syncDataSourceProperties({
      databaseRole: "meeting",
      properties: {
        Members: {
          id: "members-id",
          type: "relation",
          relation: { data_source_id: "member-data-source" },
        },
      },
      requiredPropertyNames: Object.values(DEFAULT_NOTION_PROPERTY_NAMES),
      nowIso: "2026-05-08T00:00:00.000Z",
    });

    const [rule] = store.listRules("meeting");
    assert.equal(rule?.propertyName, "Members");
    assert.equal(rule?.valueSource, "ai");
    assert.equal(rule?.protected, false);
    assert.equal(rule?.relationDataSourceId, "member-data-source");
  } finally {
    fixture.close();
  }
});

test("NotionCustomPropertyRuleStore keeps role-specific rules isolated", () => {
  const fixture = createFixture();
  try {
    const store = new NotionCustomPropertyRuleStore(fixture.runner);

    store.saveRules({
      databaseRole: "meeting",
      rules: [
        {
          propertyName: "Discussion",
          propertyType: "rich_text",
          enabled: true,
          promptDescription: "회의 논의 요약",
        },
      ],
      requiredPropertyNames: Object.values(DEFAULT_NOTION_PROPERTY_NAMES),
      nowIso: "2026-05-08T00:00:00.000Z",
    });
    store.saveRules({
      databaseRole: "member",
      rules: [
        {
          propertyName: "Members",
          propertyType: "rich_text",
          enabled: true,
          promptDescription: "작업자 메모",
        },
      ],
      requiredPropertyNames: ["디스코드 닉네임", "노션 연결"],
      nowIso: "2026-05-08T00:01:00.000Z",
    });
    store.syncDataSourceProperties({
      databaseRole: "task",
      properties: {
        작업: { id: "title", type: "title" },
        "작업 메모": { id: "task-note", type: "rich_text" },
      },
      requiredPropertyNames: ["작업"],
      nowIso: "2026-05-08T00:02:00.000Z",
    });

    assert.deepEqual(
      store.listRules("meeting").map((rule) => rule.propertyName),
      ["Discussion"],
    );
    assert.deepEqual(
      store.listRules("member").map((rule) => ({
        propertyName: rule.propertyName,
        protected: rule.protected,
      })),
      [{ propertyName: "Members", protected: false }],
    );
    assert.deepEqual(
      store.listRules("task").map((rule) => rule.propertyName),
      ["작업 메모"],
    );
    assert.doesNotMatch(
      buildNotionCustomPropertyPrompt(store.listEnabledRules("meeting")),
      /작업자 메모/,
    );

    const deleted = store.saveRules({
      databaseRole: "member",
      rules: [
        {
          originalPropertyName: "Members",
          propertyName: "Members",
          propertyType: "rich_text",
          enabled: true,
          promptDescription: "",
          deleted: true,
        },
      ],
      requiredPropertyNames: ["디스코드 닉네임", "노션 연결"],
      nowIso: "2026-05-08T00:03:00.000Z",
    });
    assert.equal(deleted.deleted, 1);
    assert.deepEqual(store.listRules("member"), []);
  } finally {
    fixture.close();
  }
});

test("NotionCustomPropertyRuleStore clearProject removes project-scoped rules", () => {
  const fixture = createFixture();
  try {
    const projectStore = new ProjectStore(fixture.runner);
    projectStore.createProject({ id: "project-a", nowIso: "2026-05-08T00:00:00.000Z" });
    projectStore.createProject({ id: "project-b", nowIso: "2026-05-08T00:00:00.000Z" });
    const store = new NotionCustomPropertyRuleStore(fixture.runner);
    store.saveRules({
      projectId: "project-a",
      databaseRole: "meeting",
      rules: [
        {
          propertyName: "Discussion",
          propertyType: "rich_text",
          enabled: true,
          promptDescription: "회의 논의 요약",
        },
      ],
      requiredPropertyNames: Object.values(DEFAULT_NOTION_PROPERTY_NAMES),
      nowIso: "2026-05-08T00:00:00.000Z",
    });
    store.saveRules({
      projectId: "project-b",
      databaseRole: "meeting",
      rules: [
        {
          propertyName: "Decision",
          propertyType: "rich_text",
          enabled: true,
          promptDescription: "결정 사항",
        },
      ],
      requiredPropertyNames: Object.values(DEFAULT_NOTION_PROPERTY_NAMES),
      nowIso: "2026-05-08T00:00:00.000Z",
    });

    assert.equal(store.clearProject("project-a"), 1);
    assert.deepEqual(store.listRules("meeting", "project-a"), []);
    assert.equal(store.listRules("meeting", "project-b")[0]?.propertyName, "Decision");
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
