#!/usr/bin/env node
// Build only the theme repository into a disposable test layer on the local
// application runtime. No working volume, app database or remote service is used.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const frontend = resolve("apps/frontend");
const require = createRequire(join(frontend, "package.json"));
const ts = require("typescript");
const root = mkdtempSync(join(tmpdir(), "asterism-theme-container-"));
const suffix = randomUUID();
const volume = `asterism-theme-check-${suffix}`;
const image = `asterism-theme-check:${suffix}`;
const base = process.env.THEME_TEST_RUNTIME_IMAGE ?? "asterism:local";
assert.match(base, /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/);
const dockerfile = readFileSync("Dockerfile", "utf8");
assert.match(dockerfile, /useradd --uid 10001/);
assert.match(dockerfile, /chown asterism:asterism \/storage/);
assert.match(dockerfile, /USER asterism/);

function docker(args) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    timeout: 120_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(result.stderr || `docker exited ${result.status}`);
  return result.stdout.trim();
}
try {
  // Fail locally rather than letting Docker pull a missing base image.
  docker(["image", "inspect", base]);
  // Transpile the actual repository and schema; server-only is a Next import
  // boundary marker and is omitted solely from these standalone test artifacts.
  for (const relative of ["server/repository", "schemas"]) {
    const source = readFileSync(
      join(frontend, "src/features/theme", `${relative}.ts`),
      "utf8",
    ).replace('import "server-only";', "");
    const compiled = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
    });
    const target = join(root, "runtime/theme", `${relative}.js`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, compiled.outputText);
  }
  const zod = dirname(require.resolve("zod/package.json"));
  cpSync(realpathSync(zod), join(root, "runtime/node_modules/zod"), {
    recursive: true,
  });
  cpSync(
    join(frontend, "src/features/theme/bundled/light.json"),
    join(root, "runtime/light.json"),
  );
  writeFileSync(
    join(root, "Dockerfile"),
    `FROM ${base}\nUSER root\nCOPY runtime /theme-check\nRUN chmod -R a+rX /theme-check\nUSER 10001:10001\nENTRYPOINT ["node", "/theme-check/run.cjs"]\n`,
  );
  writeFileSync(
    join(root, "runtime/run.cjs"),
    `
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { createThemeRepository } = require("./theme/server/repository.js");
const light = require("./light.json");
(async () => {
  assert.equal(process.getuid(), 10001);
  const repository = createThemeRepository("/storage", { light });
  if (process.argv[2] === "save") {
    await repository.save({ ...light, filename: "light", name: "Container saved" });
  } else if (process.argv[2] === "replace") {
    assert.equal((await repository.read("light")).name, "Container saved");
    await repository.save({ ...light, filename: "light", name: "Container replaced" });
  } else {
    assert.equal((await repository.read("light")).name, "Container replaced");
  }
  await assert.rejects(fs.writeFile("/theme-check/light.json", "changed"), error => ["EROFS", "EACCES"].includes(error.code));
  assert.equal(require("./light.json").name, "Default Light Theme");
  assert.equal((await fs.stat("/storage/themes/light.json")).mode & 0o777, 0o600);
  console.log(JSON.stringify({ step: process.argv[2], uid: process.getuid(), name: (await repository.read("light")).name }));
})().catch(error => { console.error(error); process.exitCode = 1; });
`,
  );
  docker(["build", "--network=none", "-t", image, root]);
  docker(["volume", "create", volume]);
  for (const step of ["save", "replace", "read"]) {
    // Every step gets a new container and a read-only application filesystem.
    console.log(
      docker([
        "run",
        "--rm",
        "--network=none",
        "--read-only",
        "--mount",
        `type=volume,src=${volume},dst=/storage`,
        image,
        step,
      ]),
    );
  }
  console.log(
    "Theme storage passed: UID 10001, atomic saves, read-only defaults, replacement containers, persistent isolated volume.",
  );
} finally {
  spawnSync("docker", ["volume", "rm", volume], { stdio: "ignore" });
  spawnSync("docker", ["image", "rm", image], { stdio: "ignore" });
  rmSync(root, { recursive: true, force: true });
}
