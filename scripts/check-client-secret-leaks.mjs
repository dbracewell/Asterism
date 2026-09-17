#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const secretNames = ["BETTER_AUTH_SECRET", "SYSTEM_KEY", "ADMIN_PASSPHRASE"];
const secrets = secretNames
  .map((name) => [name, process.env[name]])
  .filter(([, value]) => value);
const roots = process.argv.slice(2).map((path) => resolve(path));
if (roots.length === 0) {
  console.error(
    "Provide at least one browser-asset or generated-client directory",
  );
  process.exit(2);
}

function filesUnder(path) {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    filesUnder(resolve(path, entry.name)),
  );
}

const leaks = [];
for (const root of roots) {
  for (const path of filesUnder(root)) {
    const content = readFileSync(path);
    for (const [name, value] of secrets) {
      if (content.includes(Buffer.from(value))) leaks.push({ name, path });
    }
  }
}

if (leaks.length > 0) {
  for (const leak of leaks) {
    console.error(
      `${leak.name}: secret canary found in browser artifact ${leak.path}`,
    );
  }
  process.exit(1);
}
console.log("No configured secret canaries found in browser artifacts.");
