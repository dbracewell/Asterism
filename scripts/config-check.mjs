#!/usr/bin/env node

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

import { validateConfiguration } from "./config-contract.mjs";
import {
  EnvironmentError,
  loadRootEnvironment,
  REPOSITORY_ROOT,
} from "./run-with-env.mjs";

function argumentsFrom(commandLine) {
  const options = { profile: "development", scope: "all", mode: "required" };
  for (let index = 0; index < commandLine.length; index++) {
    const option = commandLine[index];
    if (option === "--profile") options.profile = commandLine[++index];
    else if (option === "--scope") options.scope = commandLine[++index];
    else if (option === "--env") options.mode = commandLine[++index];
    else throw new EnvironmentError(`Unknown option: ${option}`);
  }
  return options;
}

function printRecords(records) {
  const widths = { name: 24, source: 14, status: 10 };
  console.log(
    `${"SETTING".padEnd(widths.name)}${"SOURCE".padEnd(widths.source)}STATUS`,
  );
  for (const record of records) {
    console.log(
      `${record.name.padEnd(widths.name)}${record.source.padEnd(widths.source)}${record.status.padEnd(widths.status)}`,
    );
  }
}

try {
  const options = argumentsFrom(process.argv.slice(2));
  const loaded = loadRootEnvironment({ mode: options.mode });
  const result = validateConfiguration({
    environment: process.env,
    sources: loaded.sources,
    profile: options.profile,
    scope: options.scope,
  });
  printRecords(result.records);
  for (const issue of result.issues) {
    console.error(`${issue.name}: ${issue.message}`);
  }
  const dotenv = join(REPOSITORY_ROOT, ".env");
  if (existsSync(dotenv) && process.platform !== "win32") {
    const permissions = statSync(dotenv).mode & 0o077;
    if (permissions !== 0) {
      console.error(
        ".env: warning: restrict permissions to the file owner (recommended mode 0600)",
      );
    }
  }
  process.exitCode = result.valid ? 0 : 1;
} catch (error) {
  console.error(
    `Configuration check: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 2;
}
