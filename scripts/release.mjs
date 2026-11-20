#!/usr/bin/env node
// US-91.4: prepare a release the same way every time.
//
//   pnpm release <version> [--dry-run]
//
// Refuses unless main is checked out, clean and the same as origin/main, and
// CI passed on that commit. Refuses a version that isn't newer than the last
// release (or is older than the current version) and empty release notes.
// Then it sets the version everywhere (US-91.1), turns "Unreleased" in the
// release notes into the version and date under a new empty "Unreleased", and
// commits and tags v<version>. It pushes nothing: the printed command does.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { appVersion, setVersion, VERSION_PATTERN } from "./app-version.mjs";

export const RELEASE_NOTES = "docs/release-notes.md";
// The status checks AGENTS.md expects; each must have passed on the commit.
export const REQUIRED_CHECKS = [
  "Lint, Typecheck, Test",
  "Build and check the image",
  "Frontend E2E (Playwright)",
];
const UNRELEASED = /^## Unreleased[ \t]*$/m;

const parts = (version) => version.split(".").map(Number);

/** Negative, zero or positive as `a` is older than, equal to or newer than `b`. */
export function compareVersions(a, b) {
  const [x, y] = [parts(a), parts(b)];
  for (let index = 0; index < 3; index++) {
    if (x[index] !== y[index]) return x[index] - y[index];
  }
  return 0;
}

/** The newest version among `v<MAJOR.MINOR.PATCH>` tags, or null. */
export function latestRelease(tags) {
  return (
    tags
      .map((tag) => tag.replace(/^v/, ""))
      .filter((version) => VERSION_PATTERN.test(version))
      .sort(compareVersions)
      .at(-1) ?? null
  );
}

/** Why `version` can't be released, or null. */
export function versionProblem(version, { current, latest }) {
  if (!VERSION_PATTERN.test(version ?? "")) {
    return `Give the version as MAJOR.MINOR.PATCH, for example 0.2.0, not ${version}`;
  }
  if (latest && compareVersions(version, latest) <= 0) {
    return `${version} isn't newer than the last release, ${latest}`;
  }
  if (compareVersions(version, current) < 0) {
    return `${version} is older than the current version, ${current}`;
  }
  return null;
}

/** Why the commit's CI doesn't allow a release, or null. */
export function checksProblem(runs) {
  // A re-run adds another run with the same name; the newest one counts.
  const newest = (name) =>
    runs
      .filter((candidate) => candidate.name === name)
      .sort((a, b) => b.id - a.id)[0];
  const failing = REQUIRED_CHECKS.flatMap((name) => {
    const run = newest(name);
    if (run?.status === "completed" && run.conclusion === "success") return [];
    return [`  - ${name}: ${run ? (run.conclusion ?? run.status) : "missing"}`];
  });
  return failing.length
    ? ["CI hasn't passed on this commit:", ...failing].join("\n")
    : null;
}

/**
 * The release notes with "Unreleased" turned into `version` and `date`, under
 * a new empty "Unreleased". Throws when there is no Unreleased section or it
 * lists nothing.
 */
export function cutReleaseNotes(text, version, date) {
  const heading = UNRELEASED.exec(text);
  if (!heading)
    throw new Error(`${RELEASE_NOTES} has no "## Unreleased" section`);
  const start = heading.index + heading[0].length;
  const next = text.slice(start).search(/^## /m);
  const section =
    next === -1 ? text.slice(start) : text.slice(start, start + next);
  if (!/^\s*[-*] \S/m.test(section)) {
    throw new Error(`"Unreleased" in ${RELEASE_NOTES} lists no changes`);
  }
  return `${text.slice(0, heading.index)}## Unreleased\n\n## ${version} (${date})${text.slice(start)}`;
}

/** Today in the local time zone, as YYYY-MM-DD. */
export function today(now = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const run = (command, args) =>
  execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

function refuse(message) {
  console.error(message);
  process.exit(1);
}

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { "dry-run": { type: "boolean", default: false } },
  });
  if (positionals.length !== 1)
    refuse("Usage: pnpm release <version> [--dry-run]");
  const [version] = positionals;

  if (run("git", ["branch", "--show-current"]) !== "main")
    refuse("Check out main to release");
  if (run("git", ["status", "--porcelain"]))
    refuse("Commit or stash your changes first");
  run("git", ["fetch", "--quiet", "--tags", "origin", "main"]);
  const head = run("git", ["rev-parse", "HEAD"]);
  if (head !== run("git", ["rev-parse", "origin/main"])) {
    refuse("main differs from origin/main; pull or push first");
  }

  const tags = run("git", ["tag", "--list", "v*"]).split("\n").filter(Boolean);
  if (tags.includes(`v${version}`)) refuse(`v${version} is already tagged`);
  const problem = versionProblem(version, {
    current: appVersion(),
    latest: latestRelease(tags),
  });
  if (problem) refuse(problem);

  const runs = JSON.parse(
    run("gh", [
      "api",
      `repos/{owner}/{repo}/commits/${head}/check-runs?per_page=100`,
    ]),
  ).check_runs;
  const failing = checksProblem(runs);
  if (failing) refuse(failing);

  const date = today();
  let notes;
  try {
    notes = cutReleaseNotes(readFileSync(RELEASE_NOTES, "utf8"), version, date);
  } catch (error) {
    refuse(error.message);
  }

  if (values["dry-run"]) {
    console.log(
      `Ready to release ${version} (${date}) from ${head.slice(0, 12)}; nothing changed.`,
    );
    return;
  }
  const written = setVersion(version);
  writeFileSync(RELEASE_NOTES, notes);
  run("git", ["add", RELEASE_NOTES, ...written]);
  run("git", ["commit", "--quiet", "-m", `release: v${version}`]);
  run("git", ["tag", "-a", `v${version}`, "-m", `Asterism ${version}`]);
  console.log(
    [
      `Committed and tagged v${version}. Check the commit, then publish it:`,
      `  git push origin main v${version}`,
      `To undo before pushing: git tag -d v${version} && git reset --hard HEAD~1`,
    ].join("\n"),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    main();
  } catch (error) {
    console.error(error.stderr?.toString().trim() || error.message);
    process.exit(2);
  }
}
