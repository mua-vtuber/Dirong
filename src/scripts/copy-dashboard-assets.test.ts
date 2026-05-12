import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("copy-dashboard-assets publishes split dashboard client scripts", () => {
  const publicDir = path.resolve("dist/dashboard/public");
  const expectedFiles = [
    "index.html",
    "api-client.js",
    "setup-wizard.js",
    "notion-properties.js",
    "notion-managed-db.js",
    "dashboard-client.js",
  ];

  for (const fileName of expectedFiles) {
    assert.equal(
      existsSync(path.join(publicDir, fileName)),
      true,
      `${fileName} should be copied to dist/dashboard/public`,
    );
  }

  const html = readFileSync(path.join(publicDir, "index.html"), "utf8");
  const notionScript = readFileSync(
    path.join(publicDir, "notion-properties.js"),
    "utf8",
  );
  const managedDbScript = readFileSync(
    path.join(publicDir, "notion-managed-db.js"),
    "utf8",
  );

  assert.match(html, /\/dashboard\/api-client\.js/);
  assert.match(html, /\/dashboard\/notion-properties\.js/);
  assert.match(html, /\/dashboard\/notion-managed-db\.js/);
  assert.match(notionScript, /data-notion-action/);
  assert.match(managedDbScript, /data-managed-db-action/);
  assert.doesNotMatch(notionScript, /onclick=/);
  assert.doesNotMatch(managedDbScript, /onclick=/);
});
