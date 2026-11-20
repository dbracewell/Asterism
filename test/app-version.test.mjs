// One version for the app (US-91.1): every copy agrees with the root package.json.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  COPIES,
  SOURCE,
  appVersion,
  setVersion,
  versionProblems,
} from "../scripts/app-version.mjs";

function copyRepo() {
  const root = mkdtempSync(join(tmpdir(), "asterism-version-"));
  for (const path of [SOURCE, ...COPIES]) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    cpSync(path, join(root, path));
  }
  return root;
}

function edit(root, path, change) {
  const file = join(root, path);
  writeFileSync(file, change(readFileSync(file, "utf8")));
}

test("the repository's copies all say the root version", () => {
  assert.match(appVersion(), /^\d+\.\d+\.\d+$/);
  assert.deepEqual(versionProblems(), []);
});

test("each copy that disagrees is named", () => {
  const root = copyRepo();
  try {
    const version = appVersion(root);
    edit(root, "apps/frontend/package.json", (text) =>
      text.replace(`"version": "${version}"`, `"version": "9.9.9"`),
    );
    edit(root, "apps/backend/pyproject.toml", (text) =>
      text.replace(`version = "${version}"`, `version = "9.9.8"`),
    );
    edit(root, "apps/backend/uv.lock", (text) =>
      text.replace(
        `name = "asterism-core"\nversion = "${version}"`,
        `name = "asterism-core"\nversion = "9.9.7"`,
      ),
    );
    assert.deepEqual(versionProblems(root), [
      `apps/frontend/package.json says 9.9.9, package.json says ${version}`,
      `apps/backend/pyproject.toml says 9.9.8, package.json says ${version}`,
      `apps/backend/uv.lock says 9.9.7, package.json says ${version}`,
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a missing or malformed version is a problem", () => {
  const root = copyRepo();
  try {
    const version = appVersion(root);
    edit(root, "apps/backend/package.json", (text) =>
      text.replace(`  "version": "${version}",\n`, ""),
    );
    edit(root, SOURCE, (text) =>
      text.replace(`"version": "${version}"`, `"version": "v${version}"`),
    );
    const problems = versionProblems(root);
    assert.equal(
      problems[0],
      `package.json version v${version} is not MAJOR.MINOR.PATCH`,
    );
    assert.ok(
      problems.includes(
        `apps/backend/package.json says no version, package.json says v${version}`,
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("setting the version writes every copy and keeps the files' formatting", () => {
  const root = copyRepo();
  try {
    const before = Object.fromEntries(
      [SOURCE, ...COPIES].map((path) => [
        path,
        readFileSync(join(root, path), "utf8"),
      ]),
    );
    const version = appVersion(root);
    assert.deepEqual(setVersion("9.10.11", root), [SOURCE, ...COPIES]);
    assert.equal(appVersion(root), "9.10.11");
    assert.deepEqual(versionProblems(root), []);
    for (const path of [SOURCE, ...COPIES]) {
      // Only the version changed.
      assert.equal(
        readFileSync(join(root, path), "utf8").replace("9.10.11", version),
        before[path],
        path,
      );
    }
    assert.throws(() => setVersion("v1.0.0", root), /not MAJOR.MINOR.PATCH/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
