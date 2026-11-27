// US-101.1: the setup command writes a valid .env and never overwrites one by accident.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";

import { validateConfiguration } from "../scripts/config-contract.mjs";
import { parsePortableEnvironment } from "../scripts/run-with-env.mjs";

const parse = (text) => Object.fromEntries(parsePortableEnvironment(text));
import {
  configure,
  parseOptions,
  secret,
  SetupError,
} from "../scripts/setup.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/setup.mjs", import.meta.url));
const directories = [];
function scratch() {
  const directory = mkdtempSync(join(tmpdir(), "asterism-setup-"));
  directories.push(directory);
  return directory;
}
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

test("writes a file that passes the production contract", async () => {
  const output = join(scratch(), ".env");
  const { values } = await configure({
    output,
    publicUrl: "https://asterism.example.edu",
    trustedProxies: "172.16.0.0/12",
    version: "9.9.9",
  });
  const parsed = parse(readFileSync(output, "utf8"));
  assert.equal(parsed.ASTERISM_VERSION, "9.9.9");
  assert.equal(parsed.PUBLIC_URL, "https://asterism.example.edu");
  assert.equal(parsed.TRUSTED_PROXIES, "172.16.0.0/12");
  for (const name of ["BETTER_AUTH_SECRET", "SYSTEM_KEY", "ADMIN_PASSPHRASE"])
    assert.equal(parsed[name], values[name]);
  // The secrets are distinct and long enough for production.
  assert.equal(new Set([parsed.BETTER_AUTH_SECRET, parsed.SYSTEM_KEY]).size, 2);
  assert.ok(
    parsed.BETTER_AUTH_SECRET.length >= 32 && parsed.SYSTEM_KEY.length >= 32,
  );
  assert.ok(parsed.ADMIN_PASSPHRASE.length >= 12);
  const { issues } = validateConfiguration({
    environment: { ...parsed, STORAGE_ROOT: scratch() },
    profile: "production",
    scope: "all",
  });
  assert.deepEqual(
    issues.filter((issue) => issue.name in parsed),
    [],
  );
  // Only the owner can read the secrets.
  assert.equal(statSync(output).mode & 0o777, 0o600);
});

test("never replaces an existing file without --force", async () => {
  const output = join(scratch(), ".env");
  writeFileSync(output, "SYSTEM_KEY=keep\n", { mode: 0o644 });
  await assert.rejects(configure({ output, version: "1.0.0" }), SetupError);
  assert.equal(readFileSync(output, "utf8"), "SYSTEM_KEY=keep\n");
  await configure({ output, version: "1.0.0", force: true });
  assert.notEqual(readFileSync(output, "utf8"), "SYSTEM_KEY=keep\n");
  // A replaced file is made owner-only too (US-115.2).
  assert.equal(statSync(output).mode & 0o777, 0o600);
});

test("refuses values the container would refuse, writing nothing", async () => {
  const directory = scratch();
  await assert.rejects(
    configure({
      output: join(directory, "a.env"),
      version: "1.0.0",
      publicUrl: "http://asterism.example.edu",
    }),
    /PUBLIC_URL: must use https/,
  );
  await assert.rejects(
    configure({
      output: join(directory, "b.env"),
      version: "1.0.0",
      trustedProxies: "not-an-ip",
    }),
    /TRUSTED_PROXIES/,
  );
  assert.throws(() => readFileSync(join(directory, "a.env")));
});

test("secrets use only characters the strict .env syntax allows", () => {
  for (let index = 0; index < 50; index++)
    assert.match(secret(), /^[A-Za-z0-9_-]{43}$/);
});

test("options for scripts", () => {
  assert.deepEqual(
    parseOptions([
      "--yes",
      "--force",
      "--public-url",
      "https://a.example",
      "--version",
      "1.2.3",
    ]),
    {
      yes: true,
      force: true,
      publicUrl: "https://a.example",
      version: "1.2.3",
    },
  );
  assert.throws(() => parseOptions(["--color"]), SetupError);
  assert.throws(() => parseOptions(["--output"]), SetupError);
});

test("runs non-interactively from the command line", () => {
  const output = join(scratch(), ".env");
  const run = spawnSync(
    process.execPath,
    [SCRIPT, "--yes", "--output", output],
    {
      encoding: "utf8",
    },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stderr, /create the administrator account/);
  assert.equal(
    parse(readFileSync(output, "utf8")).PUBLIC_URL,
    "http://localhost:3000",
  );
});
