// One version for the app (US-91.1). The root package.json is the source; the
// workspace packages, the backend's pyproject.toml and its uv.lock entry must
// say the same, because Status and backups report the backend package version.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fromJson = (text) => JSON.parse(text).version;
const pyprojectVersion = (text) =>
  /^\[project\]$[^[]*?^version\s*=\s*"([^"]*)"/m.exec(text)?.[1];
const lockVersion = (text) =>
  /^\[\[package\]\]\nname = "asterism-core"\nversion = "([^"]*)"/m.exec(
    text,
  )?.[1];

export const SOURCE = "package.json";
export const COPIES = {
  "apps/frontend/package.json": fromJson,
  "apps/backend/package.json": fromJson,
  "apps/backend/pyproject.toml": pyprojectVersion,
  "apps/backend/uv.lock": lockVersion,
};

export function appVersion(root = ".") {
  return fromJson(readFileSync(join(root, SOURCE), "utf8"));
}

/** Problems that make the copies disagree with the source; empty when they agree. */
export function versionProblems(root = ".") {
  const version = appVersion(root);
  const problems = [];
  if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
    problems.push(`${SOURCE} version ${version} is not MAJOR.MINOR.PATCH`);
  }
  for (const [path, read] of Object.entries(COPIES)) {
    const copy = read(readFileSync(join(root, path), "utf8"));
    if (copy !== version) {
      problems.push(
        `${path} says ${copy ?? "no version"}, ${SOURCE} says ${version}`,
      );
    }
  }
  return problems;
}
