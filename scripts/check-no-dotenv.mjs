#!/usr/bin/env node

import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(process.argv[2] ?? ".");
const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".venv",
  "node_modules",
  "playwright-report",
  "test-results",
]);
const unexpected = [];

function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) visit(path);
    else if (entry.name.startsWith(".env") && entry.name !== ".env.example") {
      unexpected.push(relative(root, path));
    }
  }
}

visit(root);
if (unexpected.length > 0) {
  for (const path of unexpected)
    console.error(`Unexpected dotenv file: ${path}`);
  process.exit(1);
}
console.log("No untracked runtime dotenv files are present.");
