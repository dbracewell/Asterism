// Release notes keep up with migrations and configuration (US-91.3).
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  parseNameStatus,
  reasonsForNote,
  releaseNotesProblem,
} from "../scripts/check-release-notes.mjs";

const MIGRATION =
  "apps/backend/asterism/db/migrations/versions/20261120_abc_x.py";

test("new migrations and contract changes need a note; other changes don't", () => {
  assert.deepEqual(
    reasonsForNote([
      { status: "A", path: MIGRATION },
      {
        status: "M",
        path: "apps/backend/asterism/db/migrations/versions/old.py",
      },
      { status: "M", path: "scripts/config-contract.mjs" },
      { status: "M", path: "apps/frontend/src/app/page.tsx" },
    ]),
    [
      `new migration ${MIGRATION}`,
      "configuration contract change (scripts/config-contract.mjs)",
    ],
  );
  assert.equal(releaseNotesProblem([{ status: "M", path: "README.md" }]), null);
});

test("a change to the release notes satisfies the check", () => {
  const changes = [{ status: "A", path: MIGRATION }];
  assert.match(releaseNotesProblem(changes), /needs a line under "Unreleased"/);
  assert.match(releaseNotesProblem(changes), /new migration/);
  assert.equal(
    releaseNotesProblem([
      ...changes,
      { status: "M", path: "docs/release-notes.md" },
    ]),
    null,
  );
});

test("a renamed or copied file counts as adding its new path", () => {
  assert.deepEqual(
    parseNameStatus(`R100\told.py\t${MIGRATION}\nM\tREADME.md\n`),
    [
      { status: "D", path: "old.py" },
      { status: "A", path: MIGRATION },
      { status: "M", path: "README.md" },
    ],
  );
});

test("the check reads committed, uncommitted and new files since the base", () => {
  const root = mkdtempSync(join(tmpdir(), "asterism-release-notes-"));
  const run = (...args) =>
    execFileSync("git", args, { cwd: root, stdio: "pipe" });
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const check = () =>
    spawnSync(
      process.execPath,
      [resolve("scripts/check-release-notes.mjs"), "--base", "main"],
      {
        cwd: root,
        encoding: "utf8",
      },
    );
  try {
    run("init", "-q", "-b", "main");
    run("config", "user.email", "test@example.test");
    run("config", "user.name", "Test");
    write("docs/release-notes.md", "# Release notes\n");
    write("scripts/config-contract.mjs", "export {};\n");
    run("add", ".");
    run("commit", "-q", "-m", "base");
    run("checkout", "-q", "-b", "story");
    assert.equal(check().status, 0);

    write(MIGRATION, "revision = 'abc'\n");
    let result = check();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /new migration/);

    run("add", ".");
    run("commit", "-q", "-m", "migration");
    write("scripts/config-contract.mjs", "export const changed = true;\n");
    result = check();
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /new migration[\s\S]*configuration contract change/,
    );

    write(
      "docs/release-notes.md",
      "# Release notes\n\n## Unreleased\n\n- A note.\n",
    );
    assert.equal(check().status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
