#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const temporaryRoot = process.env.RUNNER_TEMP ?? tmpdir();
const root = mkdtempSync(join(temporaryRoot, "asterism-e2e-"));
const storage = join(root, "storage");
mkdirSync(storage);
const secret = () => `test-${randomBytes(24).toString("hex")}`;
const environment = {
  ...process.env,
  ASTERISM_CONFIG_PROFILE: "test",
  PUBLIC_URL: "http://localhost:3100",
  BETTER_AUTH_SECRET: secret(),
  SYSTEM_KEY: secret(),
  ADMIN_PASSPHRASE: secret(),
  STORAGE_ROOT: storage,
  BETTER_AUTH_DB_PATH: join(root, "users.db"),
};

const backendHealthUrl = "http://127.0.0.1:8000/api/py/openapi.json";

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function assertBackendPortIsAvailable() {
  try {
    await fetch(backendHealthUrl, { signal: AbortSignal.timeout(1_000) });
  } catch {
    return;
  }
  throw new Error(
    "Port 8000 is already serving a backend; the isolated E2E runner requires a free port",
  );
}

async function waitForBackend(backend) {
  const deadline = Date.now() + 120_000;
  let startupError;
  backend.once("error", (error) => {
    startupError = error;
  });

  while (Date.now() < deadline) {
    if (startupError) throw startupError;
    if (backend.exitCode !== null) {
      throw new Error(
        `Isolated backend exited before becoming ready (exit ${backend.exitCode})`,
      );
    }
    try {
      const response = await fetch(backendHealthUrl, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
    } catch {
      // The application creates its schema during startup; retry until ready.
    }
    await delay(250);
  }
  throw new Error("Timed out waiting for the isolated backend on port 8000");
}

async function stopBackend(backend) {
  if (!backend) return;
  if (process.platform === "win32") {
    if (backend.exitCode !== null) return;
    backend.kill("SIGTERM");
    return;
  }

  try {
    process.kill(-backend.pid, "SIGTERM");
  } catch (error) {
    if (error.code === "ESRCH") return;
    throw error;
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await delay(250);
    try {
      process.kill(-backend.pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") return;
      throw error;
    }
  }
  process.kill(-backend.pid, "SIGKILL");
}

let backend;
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

  const backendInitialization = spawnSync(
    process.execPath,
    [
      "../../scripts/run-with-env.mjs",
      "--env",
      "none",
      "--scope",
      "backend",
      "--profile",
      "backend-init",
      "--",
      "uv",
      "run",
      "python",
      "-m",
      "asterism.db.init_db",
    ],
    {
      cwd: join(process.cwd(), "apps", "backend"),
      env: environment,
      stdio: "inherit",
    },
  );
  if (backendInitialization.error) throw backendInitialization.error;
  if (backendInitialization.status !== 0) {
    throw new Error("Isolated backend initialization failed");
  }

  await assertBackendPortIsAvailable();
  backend = spawn("pnpm", ["dev:raw"], {
    cwd: join(process.cwd(), "apps", "backend"),
    env: environment,
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  await waitForBackend(backend);

  const result = spawnSync(
    "pnpm",
    ["--filter", "@asterism/frontend", "test:e2e"],
    { env: environment, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await stopBackend(backend);
  rmSync(root, { recursive: true, force: true });
}
