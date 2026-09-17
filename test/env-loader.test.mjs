import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, test } from "node:test";

import {
  EnvironmentError,
  environmentForScope,
  findLegacyEnvironmentFiles,
  loadRootEnvironment,
  parsePortableEnvironment,
} from "../scripts/run-with-env.mjs";

const temporaryDirectories = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "asterism-env-"));
  temporaryDirectories.push(root);
  mkdirSync(join(root, "apps", "frontend"), { recursive: true });
  mkdirSync(join(root, "apps", "backend"), { recursive: true });
  return root;
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

test("portable parser accepts the documented cross-runtime subset", () => {
  const values = parsePortableEnvironment(
    "# comment\r\nPLAIN=value\r\nURL=https://example.test:8443\r\n" +
      "SECRET=abcDEF0123+/=_-.\r\nEMPTY=\r\n",
  );
  assert.deepEqual(Object.fromEntries(values), {
    PLAIN: "value",
    URL: "https://example.test:8443",
    SECRET: "abcDEF0123+/=_-.",
    EMPTY: "",
  });
});

for (const [name, value] of [
  ["spaces", "VALUE=two words"],
  ["quotes", 'VALUE="quoted"'],
  ["inline comments", "VALUE=secret#comment"],
  ["interpolation", "VALUE=$HOME"],
  ["escapes", "VALUE=one\\ntwo"],
  ["export", "export VALUE=secret"],
  ["duplicate keys", "VALUE=one\nVALUE=two"],
]) {
  test(`portable parser rejects ${name} without echoing values`, () => {
    const canary = "DO-NOT-PRINT-THIS-SECRET";
    assert.throws(
      () => parsePortableEnvironment(`${value}\nCANARY=${canary}\n`),
      (error) =>
        error instanceof EnvironmentError && !error.message.includes(canary),
    );
  });
}

test("inherited variables, including empty values, override the root file", () => {
  const root = fixture();
  writeFileSync(join(root, ".env"), "FIRST=file\nSECOND=file\n");
  const environment = { FIRST: "inherited", SECOND: "" };
  const result = loadRootEnvironment({ root, environment });
  assert.equal(result.loaded, true);
  assert.deepEqual(environment, { FIRST: "inherited", SECOND: "" });
});

test("optional and disabled modes do not require a file", () => {
  const root = fixture();
  assert.equal(loadRootEnvironment({ root, mode: "optional" }).loaded, false);
  assert.equal(loadRootEnvironment({ root, mode: "none" }).loaded, false);
  assert.throws(
    () => loadRootEnvironment({ root, mode: "required" }),
    /Root \.env is required/,
  );
});

test("legacy files are reported by path and never changed", () => {
  const root = fixture();
  const legacy = join(root, "apps", "frontend", ".env.local");
  writeFileSync(legacy, "SECRET=legacy-canary\n");
  chmodSync(legacy, 0o000);
  try {
    assert.deepEqual(findLegacyEnvironmentFiles(root), [
      "apps/frontend/.env.local",
    ]);
    assert.throws(
      () => loadRootEnvironment({ root, mode: "optional" }),
      (error) =>
        error instanceof EnvironmentError &&
        error.message.includes("apps/frontend/.env.local") &&
        !error.message.includes("legacy-canary"),
    );
    assert.equal(existsSync(legacy), true);
  } finally {
    chmodSync(legacy, 0o600);
  }
});

test("file secrets are fallback-only and use canonical uppercase names", () => {
  const root = fixture();
  const secrets = join(root, "secrets");
  mkdirSync(secrets);
  writeFileSync(join(secrets, "SYSTEM_KEY"), "file-secret\n");
  const environment = { SYSTEM_KEY: "process-secret" };
  let result = loadRootEnvironment({
    root,
    mode: "optional",
    environment,
    secretsDirectory: secrets,
  });
  assert.equal(environment.SYSTEM_KEY, "process-secret");
  assert.equal(result.sources.get("SYSTEM_KEY"), "process");

  delete environment.SYSTEM_KEY;
  result = loadRootEnvironment({
    root,
    mode: "optional",
    environment,
    secretsDirectory: secrets,
  });
  assert.equal(environment.SYSTEM_KEY, "file-secret");
  assert.equal(result.sources.get("SYSTEM_KEY"), "file-secret");
});

test("legacy file-secret names fail without reading their values", () => {
  const root = fixture();
  const secrets = join(root, "secrets");
  mkdirSync(secrets);
  const canary = "legacy-file-secret-canary";
  writeFileSync(join(secrets, "system_key"), canary);
  assert.throws(
    () =>
      loadRootEnvironment({
        root,
        mode: "optional",
        environment: {},
        secretsDirectory: secrets,
      }),
    (error) =>
      error instanceof EnvironmentError &&
      error.message.includes("SYSTEM_KEY") &&
      !error.message.includes(canary),
  );
});

test("frontend and backend scopes remove unrelated known settings", () => {
  const environment = {
    PATH: "/bin",
    BETTER_AUTH_SECRET: "auth",
    ADMIN_PASSPHRASE: "admin",
    SYSTEM_KEY: "system",
    DB_URL: "sqlite",
    EXTRA_PROVIDER_KEY: "provider",
  };
  const backend = environmentForScope(environment, "backend");
  assert.equal(backend.BETTER_AUTH_SECRET, undefined);
  assert.equal(backend.ADMIN_PASSPHRASE, undefined);
  assert.equal(backend.SYSTEM_KEY, "system");
  assert.equal(backend.DB_URL, "sqlite");
  assert.equal(backend.EXTRA_PROVIDER_KEY, "provider");
  const frontend = environmentForScope(environment, "frontend");
  assert.equal(frontend.DB_URL, undefined);
  assert.equal(frontend.BETTER_AUTH_SECRET, "auth");
});

function copyLauncher(root) {
  mkdirSync(join(root, "scripts"));
  for (const script of ["run-with-env.mjs", "config-contract.mjs"]) {
    cpSync(
      new URL(`../scripts/${script}`, import.meta.url),
      join(root, "scripts", script),
    );
  }
  return join(root, "scripts", "run-with-env.mjs");
}

test("CLI resolves the root independently of its working directory", () => {
  const root = fixture();
  const launcher = copyLauncher(root);
  writeFileSync(join(root, ".env"), "MARKER=from-root\n");
  const result = spawnSync(
    process.execPath,
    [
      launcher,
      "--env",
      "required",
      "--scope",
      "all",
      "--profile",
      "build",
      "--",
      process.execPath,
      "-p",
      "process.env.MARKER",
    ],
    { cwd: tmpdir(), encoding: "utf8", env: { PATH: process.env.PATH } },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "from-root");
});

test("CLI preserves child exit codes", () => {
  const root = fixture();
  const launcher = copyLauncher(root);
  const result = spawnSync(
    process.execPath,
    [
      launcher,
      "--env",
      "none",
      "--",
      process.execPath,
      "-e",
      "process.exit(7)",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 7, result.stderr);
});

test("CLI reports a missing command without printing the environment", () => {
  const root = fixture();
  const launcher = copyLauncher(root);
  const canary = "missing-command-secret-canary";
  const result = spawnSync(
    process.execPath,
    [launcher, "--env", "none", "--", "definitely-not-an-asterism-command"],
    { encoding: "utf8", env: { ...process.env, SECRET_CANARY: canary } },
  );
  assert.equal(result.status, 127);
  assert.match(result.stderr, /Command not found/);
  assert.equal(result.stderr.includes(canary), false);
});

test("CLI forwards termination and does not orphan its child", async () => {
  const root = fixture();
  const launcher = copyLauncher(root);
  const ready = join(root, "ready");
  const childScript = join(root, "child.mjs");
  writeFileSync(
    childScript,
    `import {writeFileSync} from "node:fs"; writeFileSync(${JSON.stringify(ready)}, String(process.pid)); setInterval(() => {}, 1000);`,
  );
  const process_ = spawn(
    process.execPath,
    [launcher, "--env", "none", "--", process.execPath, childScript],
    { stdio: "ignore" },
  );
  for (let attempt = 0; attempt < 100 && !existsSync(ready); attempt++) {
    await delay(20);
  }
  assert.equal(existsSync(ready), true, "child did not start");
  const childPid = Number(readFileSync(ready, "utf8"));
  process_.kill("SIGTERM");
  const [code] = await new Promise((resolvePromise) =>
    process_.once("close", (...result) => resolvePromise(result)),
  );
  assert.equal(code, 128 + 15);
  assert.throws(() => process.kill(childPid, 0), { code: "ESRCH" });
});
