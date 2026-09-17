#!/usr/bin/env node

import { constants as osConstants } from "node:os";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertValidConfiguration,
  CATALOG,
  SECRET_NAMES,
} from "./config-contract.mjs";

export const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

const CONFIG_KEYS = new Set(Object.keys(CATALOG));

const SCOPES = {
  all: CONFIG_KEYS,
  frontend: new Set([
    "PUBLIC_URL",
    "BETTER_AUTH_SECRET",
    "SYSTEM_KEY",
    "ADMIN_PASSPHRASE",
    "STORAGE_ROOT",
    "BETTER_AUTH_DB_PATH",
  ]),
  backend: new Set([
    "PUBLIC_URL",
    "SYSTEM_KEY",
    "STORAGE_ROOT",
    "DB_URL",
    "CORS_ALLOWED_ORIGINS",
    "MAX_CHARS_FOR_RETRIEVAL",
    "DEFAULT_ALLOWED_TOOLS",
  ]),
};

export class EnvironmentError extends Error {}

export function findLegacyEnvironmentFiles(root = REPOSITORY_ROOT) {
  const locations = [
    root,
    join(root, "apps", "frontend"),
    join(root, "apps", "backend"),
  ];
  const found = [];

  for (const location of locations) {
    if (!existsSync(location)) continue;
    for (const entry of readdirSync(location, { withFileTypes: true })) {
      const isAllowedRootFile = location === root && entry.name === ".env";
      if (
        entry.name.startsWith(".env") &&
        entry.name !== ".env.example" &&
        !isAllowedRootFile
      ) {
        found.push(relative(root, join(location, entry.name)));
      }
    }
  }
  return found.sort();
}

function isPortableValue(value) {
  const forbidden = new Set(["#", "$", "'", '"', "`", "\\"]);
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code < 33 || code > 126 || forbidden.has(character)) return false;
  }
  return true;
}

export function parsePortableEnvironment(source) {
  if (source.startsWith("\uFEFF")) {
    throw new EnvironmentError(
      ".env line 1 is invalid: UTF-8 BOM is not supported",
    );
  }

  const values = new Map();
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator < 1) {
      throw new EnvironmentError(
        `.env line ${lineNumber} is invalid: expected KEY=VALUE`,
      );
    }
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new EnvironmentError(
        `.env line ${lineNumber} is invalid: use an unquoted portable variable name`,
      );
    }
    if (!isPortableValue(value)) {
      throw new EnvironmentError(
        `.env line ${lineNumber} is invalid: value is outside the portable dotenv grammar`,
      );
    }
    if (values.has(key)) {
      throw new EnvironmentError(
        `.env line ${lineNumber} is invalid: duplicate variable ${key}`,
      );
    }
    values.set(key, value);
  }
  return values;
}

export function loadRootEnvironment({
  root = REPOSITORY_ROOT,
  mode = "required",
  environment = process.env,
  secretsDirectory = "/run/secrets",
} = {}) {
  if (!new Set(["required", "optional", "none"]).has(mode)) {
    throw new EnvironmentError(`Unknown environment mode: ${mode}`);
  }
  const sources = new Map();
  for (const name of CONFIG_KEYS) {
    if (Object.hasOwn(environment, name)) sources.set(name, "process");
  }
  if (mode === "none") {
    return { loaded: false, variables: new Set(), sources };
  }

  const legacyFiles = findLegacyEnvironmentFiles(root);
  if (legacyFiles.length > 0) {
    throw new EnvironmentError(
      `Competing dotenv files detected: ${legacyFiles.join(", ")}. ` +
        "Move them outside the repository after reconciling them with the root .env; no files were changed.",
    );
  }

  const path = join(root, ".env");
  let parsed = new Map();
  if (!existsSync(path)) {
    if (mode === "required") {
      throw new EnvironmentError(
        "Root .env is required. Copy .env.example to .env and configure it.",
      );
    }
  } else {
    parsed = parsePortableEnvironment(readFileSync(path, "utf8"));
    for (const [key, value] of parsed) {
      if (!Object.hasOwn(environment, key)) {
        environment[key] = value;
        sources.set(key, "root-dotenv");
      }
    }
  }

  const secretEntries = existsSync(secretsDirectory)
    ? new Set(readdirSync(secretsDirectory))
    : new Set();
  for (const name of SECRET_NAMES) {
    const canonical = join(secretsDirectory, name);
    const hasCanonical = secretEntries.has(name);
    const hasLegacy = secretEntries.has(name.toLowerCase());
    if (hasCanonical && hasLegacy) {
      throw new EnvironmentError(
        `Ambiguous file secret names for ${name}; keep only the canonical uppercase file`,
      );
    }
    if (hasLegacy) {
      throw new EnvironmentError(
        `Legacy file secret name for ${name}; rename it to the canonical uppercase name`,
      );
    }
    if (!Object.hasOwn(environment, name) && hasCanonical) {
      environment[name] = readFileSync(canonical, "utf8").replace(/\r?\n$/, "");
      sources.set(name, "file-secret");
    }
  }
  return {
    loaded: existsSync(path),
    variables: new Set(parsed.keys()),
    sources,
  };
}

export function environmentForScope(environment, scope = "all") {
  const allowed = SCOPES[scope];
  if (!allowed)
    throw new EnvironmentError(`Unknown environment scope: ${scope}`);

  const childEnvironment = { ...environment };
  for (const key of CONFIG_KEYS) {
    if (!allowed.has(key)) delete childEnvironment[key];
  }
  return childEnvironment;
}

export function parseArguments(arguments_) {
  let mode = "required";
  let scope = "all";
  let profile;
  let index = 0;
  while (index < arguments_.length && arguments_[index] !== "--") {
    const option = arguments_[index++];
    if (option === "--env") mode = arguments_[index++];
    else if (option === "--scope") scope = arguments_[index++];
    else if (option === "--profile") profile = arguments_[index++];
    else throw new EnvironmentError(`Unknown option: ${option}`);
  }
  if (arguments_[index] !== "--") {
    throw new EnvironmentError("Expected -- before the command");
  }
  const command = arguments_.slice(index + 1);
  if (command.length === 0)
    throw new EnvironmentError("No command was provided");
  profile ??=
    mode === "none" ? "test" : mode === "optional" ? "build" : "development";
  return { mode, scope, profile, command };
}

export async function runCommand(command, environment) {
  const [executable, ...arguments_] = command;
  const child = spawn(executable, arguments_, {
    env: environment,
    stdio: "inherit",
  });
  let forwardedSignal;
  const handlers = new Map();
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    const handler = () => {
      forwardedSignal = signal;
      if (!child.killed) child.kill(signal);
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }

  return await new Promise((resolvePromise, rejectPromise) => {
    const removeSignalHandlers = () => {
      for (const [name, handler] of handlers) process.off(name, handler);
    };
    child.once("error", (error) => {
      removeSignalHandlers();
      rejectPromise(error);
    });
    child.once("exit", (code, signal) => {
      removeSignalHandlers();
      if (code !== null) resolvePromise(code);
      else {
        const name = signal ?? forwardedSignal;
        resolvePromise(128 + (osConstants.signals[name] ?? 1));
      }
    });
  });
}

async function main() {
  try {
    const { mode, scope, profile, command } = parseArguments(
      process.argv.slice(2),
    );
    const loaded = loadRootEnvironment({ mode });
    assertValidConfiguration({
      environment: process.env,
      sources: loaded.sources,
      profile,
      scope,
    });
    const childEnvironment = environmentForScope(process.env, scope);
    childEnvironment.ASTERISM_CONFIG_PROFILE = profile;
    const code = await runCommand(command, childEnvironment);
    process.exitCode = code;
  } catch (error) {
    const message =
      error?.code === "ENOENT"
        ? `Command not found: ${error.path}`
        : error instanceof Error
          ? error.message
          : String(error);
    console.error(`Environment launcher: ${message}`);
    process.exitCode = error?.code === "ENOENT" ? 127 : 2;
  }
}

if (
  process.argv[1] &&
  realpathSync(resolve(process.argv[1])) ===
    realpathSync(fileURLToPath(import.meta.url))
) {
  await main();
}
