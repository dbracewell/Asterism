import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";

for (const existingFile of [false, true]) {
  test(`migrate ${existingFile ? "empty existing" : "new"} database and preserve users on restart`, () => {
    const dir = mkdtempSync(join(tmpdir(), "auth-migrations-"));
    const path = join(dir, existingFile ? "users.db" : "nested/users.db");
    try {
      if (existingFile) new Database(path).close();
      const migrate = () => {
        const result = spawnSync(process.execPath, ["--experimental-strip-types", "migrate-db.mjs"], {
          env: {
            ...process.env,
            BETTER_AUTH_DB_PATH: path,
            BETTER_AUTH_SECRET: "migration-test-only-secret-at-least-32-chars",
            BETTER_AUTH_URL: "http://localhost:3000",
          },
          encoding: "utf8",
        });
        assert.equal(result.status, 0, result.stdout + result.stderr);
      };
      migrate();
      const db = new Database(path);
      try {
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
        for (const table of ["user", "session", "account", "verification", "jwks"]) {
          assert.ok(tables.includes(table), `Missing table: ${table}`);
        }
        db.prepare('INSERT INTO user (id, name, email, "emailVerified", "createdAt", "updatedAt", role, timezone) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run("test-user", "Test", "test@example.com", 0, Date.now(), Date.now(), "admin", "UTC");
        migrate();
        assert.deepEqual(db.prepare("SELECT id, role, timezone FROM user").all(), [
          { id: "test-user", role: "admin", timezone: "UTC" },
        ]);
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
