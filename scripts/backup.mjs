#!/usr/bin/env node
// `pnpm backup|restore|backup:verify` (US-86.4): runs `python -m asterism.backup`
// with the backend's environment only, naming the Better Auth database it does
// not otherwise see. After a restore, Better Auth migrates its own tables.
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

import { environmentForScope, REPOSITORY_ROOT } from "./run-with-env.mjs";

const [command, ...rest] = process.argv.slice(2);
if (!["create", "restore", "verify"].includes(command)) {
  console.error("usage: backup.mjs create|restore|verify [options]");
  process.exit(2);
}
const storageRoot = process.env.STORAGE_ROOT;
if (!storageRoot) {
  console.error(
    "STORAGE_ROOT is not set. Run this through the root package script, or set it explicitly.",
  );
  process.exit(1);
}
const authPath = resolve(
  process.env.BETTER_AUTH_DB_PATH ?? join(storageRoot, "users.db"),
);

function run(executable, arguments_, options) {
  const result = spawnSync(executable, arguments_, {
    stdio: "inherit",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const authArguments = command === "verify" ? [] : ["--auth-db", authPath];
run(
  "uv",
  [
    "run",
    "python",
    "-m",
    "asterism.backup",
    command,
    ...authArguments,
    ...rest,
  ],
  {
    cwd: join(REPOSITORY_ROOT, "apps", "backend"),
    env: environmentForScope(process.env, "backend"),
  },
);
if (command === "restore") {
  run("pnpm", ["--filter", "@asterism/frontend", "migrate:db"], {
    cwd: REPOSITORY_ROOT,
    env: process.env,
  });
}
