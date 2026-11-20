// One version for the app (US-91.1). The root package.json is the source; the
// workspace packages, the backend's pyproject.toml and its uv.lock entry must
// say the same, because Status and backups report the backend package version.
// `pnpm release` (US-91.4) sets them all with setVersion.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

// Each file's version, read and replaced in place, keeping its formatting.
const json = {
  pattern: /^(\s*"version":\s*")([^"]*)(")/m,
};
const pyproject = {
  pattern: /^(\[project\]$[^[]*?^version\s*=\s*")([^"]*)(")/m,
};
const lock = {
  pattern: /^(\[\[package\]\]\nname = "asterism-core"\nversion = ")([^"]*)(")/m,
};

export const SOURCE = "package.json";
const FILES = {
  [SOURCE]: json,
  "apps/frontend/package.json": json,
  "apps/backend/package.json": json,
  "apps/backend/pyproject.toml": pyproject,
  "apps/backend/uv.lock": lock,
};
export const COPIES = Object.keys(FILES).filter((path) => path !== SOURCE);

const readIn = (root, path) =>
  FILES[path].pattern.exec(readFileSync(join(root, path), "utf8"))?.[2];

export function appVersion(root = ".") {
  return readIn(root, SOURCE);
}

/** Problems that make the copies disagree with the source; empty when they agree. */
export function versionProblems(root = ".") {
  const version = appVersion(root);
  const problems = [];
  if (!VERSION_PATTERN.test(version ?? "")) {
    problems.push(`${SOURCE} version ${version} is not MAJOR.MINOR.PATCH`);
  }
  for (const path of COPIES) {
    const copy = readIn(root, path);
    if (copy !== version) {
      problems.push(
        `${path} says ${copy ?? "no version"}, ${SOURCE} says ${version}`,
      );
    }
  }
  return problems;
}

/** Writes `version` into the source and every copy; returns the paths written. */
export function setVersion(version, root = ".") {
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`${version} is not MAJOR.MINOR.PATCH`);
  }
  for (const [path, { pattern }] of Object.entries(FILES)) {
    const file = join(root, path);
    const text = readFileSync(file, "utf8");
    if (!pattern.test(text)) throw new Error(`${path} has no version to set`);
    writeFileSync(file, text.replace(pattern, `$1${version}$3`));
  }
  return Object.keys(FILES);
}
