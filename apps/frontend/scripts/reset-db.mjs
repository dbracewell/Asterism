#!/usr/bin/env node

import { existsSync, rmSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

const assumeYes = process.argv.includes("--yes");
const storageRoot = process.env.STORAGE_ROOT ?? "/storage";
const configuredPath =
  process.env.BETTER_AUTH_DB_PATH ?? join(storageRoot, "users.db");
if (!isAbsolute(configuredPath) || configuredPath === "/") {
  throw new Error("Refusing to reset a non-absolute or root database path");
}
const databasePath = resolve(configuredPath);

async function confirmed() {
  if (assumeYes) return true;
  if (!process.stdin.isTTY) return false;
  console.log(`Authentication database selected for deletion: ${databasePath}`);
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return (await prompt.question("Type RESET to continue: ")) === "RESET";
  } finally {
    prompt.close();
  }
}

if (!(await confirmed())) {
  throw new Error(
    "Authentication database reset canceled; no files were deleted",
  );
}

for (const path of [
  databasePath,
  `${databasePath}-wal`,
  `${databasePath}-shm`,
  `${databasePath}-journal`,
]) {
  if (existsSync(path)) rmSync(path);
}

const cli = resolve("node_modules/auth/dist/index.mjs");
const result = spawnSync(
  process.execPath,
  [cli, "migrate", "--config", "./src/lib/auth-cli.ts", "--yes"],
  {
    cwd: resolve("."),
    env: { ...process.env, ASTERISM_CONFIG_PROFILE: "auth-migrate" },
    stdio: "inherit",
  },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
