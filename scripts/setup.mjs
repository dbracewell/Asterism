#!/usr/bin/env node
// US-101.1: write a valid .env for a new installation.
//
//   pnpm configure [options]                       (in a checkout; writes ./.env)
//   docker run --rm -it --user "$(id -u):$(id -g)" -v "$PWD:/out" \
//     ghcr.io/dbracewell/asterism:<version> setup    (writes ./.env; no Node needed)
//
// It asks for the public URL and any reverse proxy, generates the three secrets,
// writes .env in the strict format docs/deployment.md describes, and checks the
// result with the same configuration contract the container runs at start.
// Options, for scripts (each skips its question):
//   --public-url <origin>   --trusted-proxies <list>   --version <x.y.z>
//   --output <path>         --force (replace an existing file)   --yes (no questions)

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { parseProxyList, validateConfiguration } from "./config-contract.mjs";
import { parsePortableEnvironment } from "./run-with-env.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTAINER_OUTPUT = "/out";

export class SetupError extends Error {}

export function parseOptions(argv) {
  const options = { force: false, yes: false };
  const valued = {
    "--public-url": "publicUrl",
    "--trusted-proxies": "trustedProxies",
    "--version": "version",
    "--output": "output",
  };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--force") options.force = true;
    else if (flag === "--yes") options.yes = true;
    else if (valued[flag]) {
      const value = argv[++index];
      if (value === undefined) throw new SetupError(`${flag} needs a value`);
      options[valued[flag]] = value;
    } else throw new SetupError(`Unknown option: ${flag}`);
  }
  return options;
}

/** A strong random value safe in the strict .env syntax (base64url, no padding). */
export function secret(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function appVersion() {
  for (const candidate of [
    join(HERE, "..", "package.json"),
    // The image keeps the frontend's package.json, which repeats the app version.
    join(HERE, "..", "apps", "frontend", "package.json"),
  ]) {
    if (existsSync(candidate))
      return JSON.parse(readFileSync(candidate, "utf8")).version;
  }
  return undefined;
}

function defaultOutput() {
  // In the container the host directory is mounted at /out.
  if (existsSync(CONTAINER_OUTPUT)) return join(CONTAINER_OUTPUT, ".env");
  if (existsSync("/app/apps")) {
    throw new SetupError(
      'Mount a directory to write .env into: docker run --rm -it --user "$(id -u):$(id -g)" -v "$PWD:/out" <image> setup',
    );
  }
  return resolve(HERE, "..", ".env");
}

/** The .env text: required settings first, then commented optional ones. */
export function renderEnvironment(values) {
  const lines = [
    "# Written by the setup command (US-101.1). Strict syntax: unquoted KEY=VALUE only;",
    "# see docs/deployment.md. Keep this file private: it holds the secrets below.",
    "",
    "# The published release to run, ghcr.io/dbracewell/asterism:<version>.",
    "# Upgrade by changing it after reading docs/release-notes.md.",
    `ASTERISM_VERSION=${values.ASTERISM_VERSION}`,
    "",
    "# The address people open, with no trailing slash.",
    `PUBLIC_URL=${values.PUBLIC_URL}`,
    "",
    "# Generated secrets. Keep SYSTEM_KEY with your backups: a backup can only be",
    "# restored with the SYSTEM_KEY it was made with. Changing BETTER_AUTH_SECRET",
    "# signs everyone out. ADMIN_PASSPHRASE creates the first administrator account.",
    `BETTER_AUTH_SECRET=${values.BETTER_AUTH_SECRET}`,
    `SYSTEM_KEY=${values.SYSTEM_KEY}`,
    `ADMIN_PASSPHRASE=${values.ADMIN_PASSPHRASE}`,
    "",
    "# The reverse proxy's address or network, comma-separated, so the real client",
    "# address reaches rate limits (ADR-0071).",
    values.TRUSTED_PROXIES
      ? `TRUSTED_PROXIES=${values.TRUSTED_PROXIES}`
      : "# TRUSTED_PROXIES=172.16.0.0/12",
    "",
    "# Optional: a different host port for Docker Compose; update PUBLIC_URL to match.",
    "# PORT=3000",
    "",
  ];
  return lines.join("\n");
}

/** Problems with the values, from the same contract the container checks at start. */
export function problems(values) {
  const environment = { ...values };
  delete environment.ASTERISM_VERSION;
  const written = new Set(Object.keys(environment));
  const { issues } = validateConfiguration({
    environment,
    profile: "production",
    scope: "all",
  });
  // Storage paths are the container's and don't exist here; only check what is written.
  return issues.filter((issue) => written.has(issue.name));
}

async function ask(question, fallback) {
  const reader = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    const answer = (
      await reader.question(`${question}${fallback ? ` [${fallback}]` : ""}: `)
    ).trim();
    return answer || fallback || "";
  } finally {
    reader.close();
  }
}

export async function configure(options, { interactive = false } = {}) {
  const output = options.output ? resolve(options.output) : defaultOutput();
  if (existsSync(output) && !options.force) {
    throw new SetupError(
      `${output} already exists. Its secrets protect existing data; to replace it anyway, add --force.`,
    );
  }
  const values = {
    ASTERISM_VERSION: options.version ?? appVersion(),
    PUBLIC_URL: options.publicUrl,
    TRUSTED_PROXIES: options.trustedProxies,
    BETTER_AUTH_SECRET: secret(),
    SYSTEM_KEY: secret(),
    ADMIN_PASSPHRASE: secret(18),
  };
  if (interactive && !options.publicUrl) {
    values.PUBLIC_URL = await ask(
      "Public URL people will open (https unless it is localhost)",
      "http://localhost:3000",
    );
  }
  if (interactive && options.trustedProxies === undefined) {
    values.TRUSTED_PROXIES = await ask(
      "Reverse proxy address or network, if any (blank for none)",
      "",
    );
  }
  values.PUBLIC_URL ??= "http://localhost:3000";
  if (!values.TRUSTED_PROXIES) delete values.TRUSTED_PROXIES;
  if (!values.ASTERISM_VERSION)
    throw new SetupError("Pass --version: the app version wasn't found");
  if (values.TRUSTED_PROXIES) parseProxyList(values.TRUSTED_PROXIES);

  const found = problems(values);
  if (found.length) {
    throw new SetupError(
      found.map((issue) => `${issue.name}: ${issue.message}`).join("\n"),
    );
  }
  const text = renderEnvironment(values);
  parsePortableEnvironment(text); // The strict syntax the launcher and compose read.
  writeFileSync(output, text, {
    mode: 0o600,
    flag: options.force ? "w" : "wx",
  });
  return { output, values };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const interactive = !options.yes && process.stdin.isTTY === true;
  const { output, values } = await configure(options, { interactive });
  console.error(`
Wrote ${output}

Next:
  1. Keep a copy of SYSTEM_KEY somewhere safe, apart from your backups.
  2. Start Asterism: docker compose up -d
  3. Open ${values.PUBLIC_URL} and create the administrator account with
     this admin passphrase (it is also in the file as ADMIN_PASSPHRASE):

     ${values.ADMIN_PASSPHRASE}

The setup walkthrough in the app takes it from there.`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error instanceof SetupError ? error.message : error);
    process.exit(1);
  });
}
