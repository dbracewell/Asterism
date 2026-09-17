#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const temporaryRoot = process.env.RUNNER_TEMP ?? tmpdir();
const root = mkdtempSync(join(temporaryRoot, "asterism-e2e-"));
const storage = join(root, "storage");
mkdirSync(storage);
const secret = () => `test-${randomBytes(24).toString("hex")}`;
const environment = {
  ...process.env,
  PUBLIC_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: secret(),
  SYSTEM_KEY: secret(),
  ADMIN_PASSPHRASE: secret(),
  STORAGE_ROOT: storage,
  BETTER_AUTH_DB_PATH: join(root, "users.db"),
};

try {
  const migration = spawnSync(process.execPath, ["scripts/migrate-db.mjs"], {
    cwd: join(process.cwd(), "apps/frontend"),
    env: environment,
    stdio: "inherit",
  });
  if (migration.error) throw migration.error;
  if (migration.status !== 0) {
    throw new Error("Isolated authentication migration failed");
  }

  const result = spawnSync(
    "pnpm",
    ["--filter", "@asterism/frontend", "test:e2e"],
    { env: environment, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
