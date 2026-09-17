import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import Database from "better-sqlite3";

const cwd = fileURLToPath(new URL("../", import.meta.url));
for (const override of [false, true]) {
  test(`official auth CLI initializes and preserves data (${override ? "override" : "storage root"})`, () => {
    const dir = mkdtempSync(join(tmpdir(), "docker-auth-"));
    const path = join(dir, override ? "custom.db" : "users.db");
    try {
      const migrate = () => {
        const environment = {
          ...process.env,
          ASTERISM_CONFIG_PROFILE: "auth-migrate",
          STORAGE_ROOT: dir,
          BETTER_AUTH_SECRET: "migration-canary-secret-at-least-32-chars",
          PUBLIC_URL: "http://localhost:3000",
          BETTER_AUTH_TELEMETRY: "0",
        };
        if (override) environment.BETTER_AUTH_DB_PATH = path;
        else delete environment.BETTER_AUTH_DB_PATH;
        const result = spawnSync(
          process.execPath,
          [
            "node_modules/auth/dist/index.mjs",
            "migrate",
            "--config",
            "./src/lib/auth-cli.ts",
            "--yes",
          ],
          {
            cwd,
            env: environment,
            encoding: "utf8",
            timeout: 60000,
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
          .map(({ name }) => name);
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
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
