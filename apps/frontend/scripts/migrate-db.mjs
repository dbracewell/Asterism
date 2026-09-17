#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

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
