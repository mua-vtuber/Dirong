import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateActiveProjectCommandGate,
} from "./active-project-command-gate.js";
import type { DirongProjectRow } from "../projects/project-types.js";

test("active project gate allows the active project guild", () => {
  const result = evaluateActiveProjectCommandGate({
    guildId: "guild-active",
    legacyGuildIds: ["legacy-guild"],
    activeProject: project({ id: "project-a", guild_id: "guild-active" }),
    hasProjectData: true,
  });

  assert.deepEqual(result, { ok: true, projectId: "project-a" });
});

test("active project gate rejects a different guild when active project exists", () => {
  const result = evaluateActiveProjectCommandGate({
    guildId: "guild-other",
    legacyGuildIds: ["guild-other"],
    activeProject: project({ id: "project-a", guild_id: "guild-active" }),
    hasProjectData: true,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "active_project_guild_mismatch");
    assert.equal(result.activeProjectId, "project-a");
  }
});

test("active project gate honors command_enabled", () => {
  const result = evaluateActiveProjectCommandGate({
    guildId: "guild-active",
    legacyGuildIds: ["guild-active"],
    activeProject: project({
      id: "project-a",
      guild_id: "guild-active",
      command_enabled: 0,
    }),
    hasProjectData: true,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "active_project_command_disabled");
  }
});

test("active project gate preserves legacy allowlist when no project data exists", () => {
  const result = evaluateActiveProjectCommandGate({
    guildId: "legacy-guild",
    legacyGuildIds: ["legacy-guild"],
    activeProject: null,
    hasProjectData: false,
  });

  assert.deepEqual(result, { ok: true, projectId: null });
});

function project(
  overrides: Partial<DirongProjectRow> = {},
): DirongProjectRow {
  return {
    id: "project-a",
    name: "Project A",
    lifecycle_status: "ready",
    guild_id: "guild-active",
    guild_name: "Guild Active",
    guild_icon_url: null,
    command_enabled: 1,
    notion_token_secret_ref: null,
    notion_parent_page_url: null,
    notion_upload_mode: "manual",
    created_at: "2026-05-13T00:00:00.000Z",
    updated_at: "2026-05-13T00:00:00.000Z",
    archived_at: null,
    ...overrides,
  };
}
