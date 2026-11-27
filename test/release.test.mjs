// Cutting a release (US-91.4): versions, CI and the release notes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  COPIES,
  appVersion,
  versionProblems,
} from "../scripts/app-version.mjs";
import {
  REQUIRED_CHECKS,
  checksProblem,
  compareVersions,
  cutReleaseNotes,
  latestRelease,
  today,
  versionProblem,
} from "../scripts/release.mjs";

test("versions compare by number, not text", () => {
  assert.ok(compareVersions("0.10.0", "0.9.9") > 0);
  assert.ok(compareVersions("1.0.0", "0.99.99") > 0);
  assert.equal(compareVersions("0.2.0", "0.2.0"), 0);
  assert.equal(
    latestRelease(["v0.2.0", "v0.10.1", "v0.9.0", "nightly", "v1.0"]),
    "0.10.1",
  );
  assert.equal(latestRelease([]), null);
});

test("a release must be newer than the last and no older than the current version", () => {
  // The first release may be the version the packages already say.
  assert.equal(
    versionProblem("0.2.0", { current: "0.2.0", latest: null }),
    null,
  );
  assert.equal(
    versionProblem("0.3.0", { current: "0.2.0", latest: "0.2.0" }),
    null,
  );
  assert.match(
    versionProblem("0.2.0", { current: "0.2.0", latest: "0.2.0" }),
    /isn't newer than the last release, 0\.2\.0/,
  );
  assert.match(
    versionProblem("0.1.9", { current: "0.2.0", latest: null }),
    /older than the current version/,
  );
  assert.match(
    versionProblem("v0.3.0", { current: "0.2.0", latest: null }),
    /MAJOR\.MINOR\.PATCH/,
  );
  assert.match(
    versionProblem(undefined, { current: "0.2.0", latest: null }),
    /MAJOR\.MINOR\.PATCH/,
  );
});

test("every expected check must have passed, judged by its newest run", () => {
  const passed = REQUIRED_CHECKS.map((name, index) => ({
    id: index + 1,
    name,
    status: "completed",
    conclusion: "success",
  }));
  assert.equal(checksProblem(passed), null);
  const rerun = [
    ...passed.slice(1),
    {
      id: 100,
      name: REQUIRED_CHECKS[0],
      status: "completed",
      conclusion: "failure",
    },
    {
      id: 200,
      name: REQUIRED_CHECKS[0],
      status: "completed",
      conclusion: "success",
    },
  ];
  assert.equal(checksProblem(rerun), null);
  const problem = checksProblem([
    {
      id: 1,
      name: REQUIRED_CHECKS[0],
      status: "completed",
      conclusion: "failure",
    },
    {
      id: 2,
      name: REQUIRED_CHECKS[1],
      status: "in_progress",
      conclusion: null,
    },
  ]);
  assert.equal(
    problem,
    [
      "CI hasn't passed on this commit:",
      `  - ${REQUIRED_CHECKS[0]}: failure`,
      `  - ${REQUIRED_CHECKS[1]}: in_progress`,
      `  - ${REQUIRED_CHECKS[2]}: missing`,
    ].join("\n"),
  );
});

// Notes with something to release. The repository's own notes can't be used:
// straight after a release, its Unreleased is empty by design.
const NOTES = [
  "# Release notes",
  "",
  "Intro.",
  "",
  "## Unreleased",
  "",
  "### Data",
  "",
  "- A migration.",
  "",
  "## 0.1.0 (2026-01-01)",
  "",
  "- Older.",
  "",
].join("\n");

test("Unreleased becomes the version under a new empty Unreleased", () => {
  const notes = NOTES;
  assert.equal(
    cutReleaseNotes(notes, "0.2.0", "2026-11-20"),
    notes.replace(
      "## Unreleased\n",
      "## Unreleased\n\n## 0.2.0 (2026-11-20)\n",
    ),
  );
  const cut = cutReleaseNotes(notes, "0.2.0", "2026-11-20");
  // Releasing twice in a row finds nothing to release.
  assert.throws(
    () => cutReleaseNotes(cut, "9.9.10", "2026-11-21"),
    /lists no changes/,
  );
});

test("empty or missing release notes are refused", () => {
  assert.throws(
    () =>
      cutReleaseNotes(
        "# Notes\n\n## Unreleased\n\n### Data\n\n## 0.1.0 (x)\n\n- Old.\n",
        "0.2.0",
        "d",
      ),
    /lists no changes/,
  );
  assert.throws(
    () => cutReleaseNotes("# Notes\n", "0.2.0", "d"),
    /no "## Unreleased" section/,
  );
});

test("the date is the local calendar day", () => {
  assert.equal(today(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
});

test("pnpm release commits and tags, and refuses what it should", () => {
  const root = mkdtempSync(join(tmpdir(), "asterism-release-"));
  const origin = join(root, "origin.git");
  const work = join(root, "work");
  const bin = join(root, "bin");
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: work,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  const files = ["package.json", ...COPIES];
  // A stand-in for `gh api` that reports every expected check as passed.
  const runs = REQUIRED_CHECKS.map((name, id) => ({
    id,
    name,
    status: "completed",
    conclusion: "success",
  }));
  const release = (...args) =>
    spawnSync(process.execPath, [resolve("scripts/release.mjs"), ...args], {
      cwd: work,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });
  try {
    mkdirSync(bin);
    writeFileSync(
      join(bin, "gh"),
      `#!/bin/sh\necho '${JSON.stringify({ check_runs: runs })}'\n`,
      { mode: 0o755 },
    );
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
    execFileSync("git", ["clone", "-q", origin, work], { stdio: "pipe" });
    git("config", "user.email", "test@example.test");
    git("config", "user.name", "Test");
    git("checkout", "-q", "-b", "main");
    for (const path of files) {
      mkdirSync(dirname(join(work, path)), { recursive: true });
      cpSync(path, join(work, path));
    }
    mkdirSync(join(work, "docs"));
    writeFileSync(join(work, "docs/release-notes.md"), NOTES);
    cpSync("SECURITY.md", join(work, "SECURITY.md"));
    const current = appVersion(work);
    // Forced: a global gitignore may ignore .env* files, which the repository's
    // own .gitignore re-includes.
    git("add", "--force", ".");
    git("commit", "-q", "-m", "base");
    git("push", "-q", "origin", "main");

    writeFileSync(join(work, "stray.txt"), "x");
    assert.match(release(current).stderr, /Commit or stash/);
    rmSync(join(work, "stray.txt"));
    assert.match(release("0.0.1").stderr, /older than the current version/);

    const dry = release(current, "--dry-run");
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /nothing changed/);
    assert.equal(git("status", "--porcelain"), "");

    const done = release(current);
    assert.equal(done.status, 0, done.stderr);
    assert.match(done.stdout, new RegExp(`git push origin main v${current}`));
    assert.equal(git("log", "-1", "--format=%s"), `release: v${current}`);
    assert.equal(git("describe", "--exact-match"), `v${current}`);
    assert.equal(git("status", "--porcelain"), "");
    assert.match(
      readFileSync(join(work, "docs/release-notes.md"), "utf8"),
      new RegExp(
        `^## Unreleased\\n\\n## ${current.replaceAll(".", "\\.")} \\(\\d{4}-\\d{2}-\\d{2}\\)$`,
        "m",
      ),
    );
    assert.deepEqual(versionProblems(work), []);

    // Not pushed yet, then pushed: the same version again is refused.
    assert.match(release("9.0.0").stderr, /differs from origin\/main/);
    git("push", "-q", "origin", "main", `v${current}`);
    assert.match(
      release(current).stderr,
      new RegExp(`v${current} is already tagged`),
    );
    // A newer version with nothing under Unreleased is refused too.
    assert.match(release("9.0.0").stderr, /lists no changes/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
