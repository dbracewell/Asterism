import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

test("workspace check accepts source-storage prose and rejects shell sourcing", () => {
  const root = mkdtempSync(join(tmpdir(), "asterism-workspace-check-"));
  const files = [
    "package.json",
    "apps/backend/package.json",
    "apps/frontend/package.json",
    "scripts/reset-databases.mjs",
    "apps/frontend/scripts/migrate-db.mjs",
    "apps/frontend/scripts/reset-db.mjs",
    "apps/backend/asterism/db/init_db.py",
    "pnpm-lock.yaml",
    "Dockerfile",
    ".github/workflows/ci.yml",
    "AGENTS.md",
    "README.md",
    "apps/backend/README.md",
    "apps/frontend/README.md",
  ];
  try {
    for (const file of files) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      copyFileSync(file, join(root, file));
    }
    const check = () =>
      spawnSync(
        process.execPath,
        [resolve("scripts/check-workspace-tasks.mjs")],
        { cwd: root, encoding: "utf8" },
      );
    assert.equal(check().status, 0);
    const packagePath = join(root, "package.json");
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
    const original = packageJson.scripts["reset:db"];
    for (const command of ["source .env", ". .env", "source config.env"]) {
      packageJson.scripts["reset:db"] = `${command} && ${original}`;
      writeFileSync(packagePath, JSON.stringify(packageJson));
      assert.notEqual(check().status, 0, command);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
