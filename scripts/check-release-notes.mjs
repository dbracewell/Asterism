#!/usr/bin/env node
// US-91.3: changes administrators must act on come with release notes.
//
//   pnpm check:release-notes [--base origin/main]
//
// Compares the work since it branched from the base (committed, staged,
// unstaged and new files) and fails when it adds an Alembic revision or
// changes the configuration contract without changing docs/release-notes.md.
// Other changes that need a note (the image, documented behavior) are left to
// review: see the Definition of Done in AGENTS.md.
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export const RELEASE_NOTES = "docs/release-notes.md";
export const CONFIG_CONTRACT = "scripts/config-contract.mjs";
const MIGRATIONS =
  /^apps\/backend\/asterism\/db\/migrations\/versions\/[^/]+\.py$/;

/** Why a release note is needed, one reason per changed file; empty when none is. */
export function reasonsForNote(changes) {
  const reasons = [];
  for (const { status, path } of changes) {
    if (status === "A" && MIGRATIONS.test(path)) {
      reasons.push(`new migration ${path}`);
    } else if (path === CONFIG_CONTRACT) {
      reasons.push(`configuration contract change (${path})`);
    }
  }
  return reasons;
}

/** A failure message, or null when the notes changed or no note is needed. */
export function releaseNotesProblem(changes) {
  const reasons = reasonsForNote(changes);
  if (reasons.length === 0) return null;
  if (changes.some(({ path }) => path === RELEASE_NOTES)) return null;
  return [
    `${RELEASE_NOTES} needs a line under "Unreleased" for:`,
    ...reasons.map((reason) => `  - ${reason}`),
    "Say what changes for an administrator and what they must do, under Configuration, Data, Image or Behavior.",
  ].join("\n");
}

/** Parses `git diff --name-status` output; a rename or copy counts as adding its new path. */
export function parseNameStatus(text) {
  return text
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const [status, ...paths] = line.split("\t");
      const kind = status[0];
      if (kind === "R" || kind === "C") {
        return [
          { status: "D", path: paths[0] },
          { status: "A", path: paths[1] },
        ];
      }
      return [{ status: kind, path: paths[0] }];
    });
}

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

/** Everything changed since the work branched from `base`, including uncommitted and new files. */
export function changesSince(base) {
  const start = git(["merge-base", base, "HEAD"]).trim();
  const tracked = parseNameStatus(
    git(["diff", "--name-status", "--find-renames", start]),
  );
  const untracked = git(["ls-files", "--others", "--exclude-standard"])
    .split("\n")
    .filter(Boolean)
    .map((path) => ({ status: "A", path }));
  return [...tracked, ...untracked];
}

function main() {
  const { values } = parseArgs({
    options: { base: { type: "string", default: "origin/main" } },
  });
  const problem = releaseNotesProblem(changesSince(values.base));
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
  console.log(
    `Release notes are in step with the changes since ${values.base}.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
