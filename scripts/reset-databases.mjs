#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

const assumeYes = process.argv.includes("--yes");
const storageRoot = process.env.STORAGE_ROOT;
const authPath = resolve(
  process.env.BETTER_AUTH_DB_PATH ?? join(storageRoot, "users.db"),
);
const backendPath = process.env.DB_URL
  ? resolve(process.env.DB_URL.slice("sqlite+aiosqlite:///".length))
  : resolve(join(storageRoot, "database.db"));

async function confirmed() {
  console.log("The following local SQLite databases will be deleted:");
  console.log(`- authentication: ${authPath}`);
  console.log(`- backend: ${backendPath}`);
  if (assumeYes) return true;
  if (!process.stdin.isTTY) return false;
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
  throw new Error("Database reset canceled; no files were deleted");
}

for (const [workspace, command] of [
  ["@asterism/backend", "reset:db:confirmed"],
  ["@asterism/frontend", "reset:db:confirmed"],
]) {
  const result = spawnSync("pnpm", ["--filter", workspace, command], {
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
