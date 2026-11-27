import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("reset-databases refuses a DB_URL that isn't SQLite and deletes nothing", () => {
  const storage = mkdtempSync(join(tmpdir(), "asterism-reset-"));
  try {
    const kept = join(storage, "users.db");
    writeFileSync(kept, "data");
    const result = spawnSync(
      process.execPath,
      ["scripts/reset-databases.mjs", "--yes"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          STORAGE_ROOT: storage,
          DB_URL: "postgresql://db.example/asterism",
        },
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /must start with sqlite\+aiosqlite:\/\/\//);
    assert.ok(existsSync(kept));
  } finally {
    rmSync(storage, { recursive: true, force: true });
  }
});
