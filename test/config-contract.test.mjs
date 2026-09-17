import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";

import {
  assertValidConfiguration,
  ConfigurationError,
  validateConfiguration,
} from "../scripts/config-contract.mjs";

const temporaryDirectories = [];
function temporaryDirectory() {
  const path = mkdtempSync(join(tmpdir(), "asterism-config-"));
  temporaryDirectories.push(path);
  return path;
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function validDevelopmentEnvironment(root) {
  return {
    PUBLIC_URL: "http://localhost:3000",
    BETTER_AUTH_SECRET: "valid-better-auth-secret-000000000",
    SYSTEM_KEY: "valid-system-key-00000000000000000",
    ADMIN_PASSPHRASE: "valid-admin-passphrase",
    STORAGE_ROOT: join(root, "storage"),
  };
}

test("development configuration validates without creating storage", () => {
  const root = temporaryDirectory();
  const storage = join(root, "storage");
  const result = validateConfiguration({
    environment: validDevelopmentEnvironment(root),
    profile: "development",
    scope: "all",
  });
  assert.equal(result.valid, true, JSON.stringify(result.issues));
  assert.equal(existsSync(storage), false);
});

test("runtime errors are redacted", () => {
  const root = temporaryDirectory();
  const canary = "replace-with-DO-NOT-PRINT-CONFIG-CANARY";
  assert.throws(
    () =>
      assertValidConfiguration({
        environment: {
          ...validDevelopmentEnvironment(root),
          BETTER_AUTH_SECRET: canary,
          DB_URL: "postgresql://user:password-canary@example.test/private",
        },
        profile: "development",
        scope: "all",
      }),
    (error) =>
      error instanceof ConfigurationError &&
      !error.message.includes(canary) &&
      !error.message.includes("password-canary") &&
      error.message.includes("BETTER_AUTH_SECRET") &&
      error.message.includes("DB_URL"),
  );
});

test("production applies URL and secret strength rules", () => {
  const root = temporaryDirectory();
  const result = validateConfiguration({
    environment: {
      ...validDevelopmentEnvironment(root),
      PUBLIC_URL: "http://asterism.example.com",
      SYSTEM_KEY: "short",
    },
    profile: "production",
    scope: "all",
  });
  assert.equal(result.valid, false);
  assert.deepEqual(
    new Set(result.issues.map((issue) => issue.name)),
    new Set(["PUBLIC_URL", "SYSTEM_KEY"]),
  );
});

test("build and test profiles require no runtime credentials", () => {
  for (const profile of ["build", "test", "codegen"]) {
    const result = validateConfiguration({
      environment: {},
      profile,
      scope: "all",
    });
    assert.equal(
      result.valid,
      true,
      `${profile}: ${JSON.stringify(result.issues)}`,
    );
  }
});

test("browser artifact scanner detects and redacts secret canaries", () => {
  const root = temporaryDirectory();
  const artifact = join(root, "client.js");
  const canary = "browser-secret-canary-never-print";
  writeFileSync(artifact, `window.value=${JSON.stringify(canary)};`);
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("../scripts/check-client-secret-leaks.mjs", import.meta.url),
      ),
      artifact,
    ],
    {
      encoding: "utf8",
      env: { PATH: process.env.PATH, SYSTEM_KEY: canary },
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SYSTEM_KEY/);
  assert.equal(result.stderr.includes(canary), false);
});

test("config check reports sources and validity but not values", () => {
  const root = temporaryDirectory();
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "apps", "frontend"), { recursive: true });
  mkdirSync(join(root, "apps", "backend"), { recursive: true });
  for (const script of [
    "config-check.mjs",
    "config-contract.mjs",
    "run-with-env.mjs",
  ]) {
    cpSync(
      new URL(`../scripts/${script}`, import.meta.url),
      join(root, "scripts", script),
    );
  }
  const canary = "valid-better-auth-secret-config-check-canary";
  writeFileSync(
    join(root, ".env"),
    [
      "PUBLIC_URL=http://localhost:3000",
      `BETTER_AUTH_SECRET=${canary}`,
      "SYSTEM_KEY=valid-system-key-00000000000000000",
      "ADMIN_PASSPHRASE=valid-admin-passphrase",
      `STORAGE_ROOT=${join(root, "storage")}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  const result = spawnSync(
    process.execPath,
    [join(root, "scripts", "config-check.mjs")],
    { encoding: "utf8", env: { PATH: process.env.PATH } },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /BETTER_AUTH_SECRET\s+root-dotenv\s+valid/);
  assert.equal(`${result.stdout}${result.stderr}`.includes(canary), false);
  assert.equal(existsSync(join(root, "storage")), false);
});
