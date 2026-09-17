import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";

for (const [existingFile, useOverride] of [
  [false, false],
  [false, true],
  [true, false],
  [true, true],
]) {
  test(`migrate/reset ${existingFile ? "existing" : "new"} database via ${useOverride ? "override" : "storage root"}`, () => {
    const dir = mkdtempSync(join(tmpdir(), "auth-migrations-"));
    const path = join(dir, existingFile ? "users.db" : "nested/users.db");
    try {
      if (existingFile) new Database(path).close();
      const migrate = (script = "migrate-db.mjs", arguments_ = []) => {
        const environment = {
          ...process.env,
          STORAGE_ROOT: useOverride ? join(dir, "unused") : join(path, ".."),
          BETTER_AUTH_SECRET: "migration-test-only-secret-at-least-32-chars",
          PUBLIC_URL: "http://localhost:3000",
        };
        if (useOverride) environment.BETTER_AUTH_DB_PATH = path;
        else delete environment.BETTER_AUTH_DB_PATH;
        const result = spawnSync(
          process.execPath,
          [join("scripts", script), ...arguments_],
          {
            env: environment,
            encoding: "utf8",
          },
        );
        assert.equal(result.status, 0, result.stdout + result.stderr);
      };
      migrate();
      const db = new Database(path);
      try {
        const tables = db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all()
          .map((row) => row.name);
        for (const table of [
          "user",
          "session",
          "account",
          "verification",
          "jwks",
        ]) {
          assert.ok(tables.includes(table), `Missing table: ${table}`);
        }
        db.prepare(
          'INSERT INTO user (id, name, email, "emailVerified", "createdAt", "updatedAt", role, timezone) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(
          "test-user",
          "Test",
          "test@example.com",
          0,
          Date.now(),
          Date.now(),
          "admin",
          "UTC",
        );
        migrate();
        assert.deepEqual(
          db.prepare("SELECT id, role, timezone FROM user").all(),
          [{ id: "test-user", role: "admin", timezone: "UTC" }],
        );
      } finally {
        db.close();
      }
      migrate("reset-db.mjs", ["--yes"]);
      const resetDb = new Database(path);
      try {
        assert.equal(
          resetDb.prepare("SELECT count(*) AS count FROM user").get().count,
          0,
        );
      } finally {
        resetDb.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
