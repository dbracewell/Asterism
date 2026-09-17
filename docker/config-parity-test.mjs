#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { parsePortableEnvironment } from "../scripts/run-with-env.mjs";

const applicationNames = [
  "PUBLIC_URL",
  "BETTER_AUTH_SECRET",
  "SYSTEM_KEY",
  "ADMIN_PASSPHRASE",
];
const names = [...applicationNames, "PORT"];
const expected = {
  PUBLIC_URL: "http://localhost:34567",
  BETTER_AUTH_SECRET: "parity-Aa09+/=_-..auth",
  SYSTEM_KEY: "parity-Bb18+/=_-..system",
  ADMIN_PASSPHRASE: "parity-Cc27+/=_-..admin",
  PORT: "34567",
};
const directory = mkdtempSync(join(tmpdir(), "asterism-parity-"));
const path = join(directory, "portable.env");
writeFileSync(
  path,
  `${Object.entries(expected)
    .map(([name, value]) => `${name}=${value}`)
    .join("\n")}\n`,
  { mode: 0o600 },
);

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} configuration parity command failed`);
  }
  return result.stdout;
}

try {
  assert.deepEqual(
    Object.fromEntries(parsePortableEnvironment(readFileSync(path, "utf8"))),
    expected,
  );
  const compose = JSON.parse(
    run("docker", [
      "compose",
      "--env-file",
      path,
      "-f",
      resolve("docker-compose.yml"),
      "config",
      "--format",
      "json",
    ]),
  );
  const composeEnvironment = compose.services.asterism.environment;
  assert.deepEqual(
    Object.fromEntries(
      applicationNames.map((name) => [name, String(composeEnvironment[name])]),
    ),
    Object.fromEntries(applicationNames.map((name) => [name, expected[name]])),
  );
  assert.equal(
    String(compose.services.asterism.ports[0].published),
    expected.PORT,
  );

  const direct = JSON.parse(
    run("docker", [
      "run",
      "--rm",
      "--env-file",
      path,
      "--entrypoint",
      "node",
      "node:22-slim",
      "-e",
      `console.log(JSON.stringify(Object.fromEntries(${JSON.stringify(names)}.map(name => [name, process.env[name]]))))`,
    ]),
  );
  assert.deepEqual(direct, expected);
  console.log("Portable configuration bytes match Node, Compose, and Docker.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
