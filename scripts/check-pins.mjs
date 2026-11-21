#!/usr/bin/env node
/**
 * Checks that the build pulls only immutable inputs (US-92.1).
 *
 * - A Dockerfile's `# syntax=` frontend, and every `FROM` in it, names an image
 *   by digest (`image:tag@sha256:…`); a `FROM` may instead name a stage declared
 *   earlier in the same file, or `scratch`.
 * - Every `uses:` in `.github/workflows/` names an action by full commit SHA
 *   (`owner/repo@<40 hex> # vX.Y.Z`), a local action (`./…`), or a
 *   `docker://` image by digest.
 * - Every workflow `container:` or service `image:` names an image by digest.
 *   A value computed by an expression (`${{ … }}`) is not checked.
 *
 * Problems name the file and line. Usage: node scripts/check-pins.mjs [root]
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const DIGEST = /@sha256:[0-9a-f]{64}$/;
const COMMIT = /@[0-9a-f]{40}$/;
const ignoredDirectories = new Set([".git", "node_modules", ".next", ".venv"]);

/** Removes a trailing YAML comment and surrounding quotes from a value. */
function yamlValue(raw) {
  const value = raw.replace(/\s+#.*$/, "").trim();
  return value.replace(/^(["'])(.*)\1$/, "$2");
}

/** Problems in one Dockerfile's `FROM` lines. */
export function dockerfileProblems(text, file) {
  const problems = [];
  const stages = new Set();
  const syntax = text.match(/^#\s*syntax\s*=\s*(\S+)/i);
  if (syntax && !DIGEST.test(syntax[1])) {
    problems.push(`${file}:1: syntax ${syntax[1]} is not pinned by digest (image:tag@sha256:…)`);
  }
  text.split("\n").forEach((line, index) => {
    const from = line.match(/^\s*FROM\s+(.*)$/i);
    if (!from) return;
    const words = from[1]
      .trim()
      .split(/\s+/)
      .filter((word) => !word.startsWith("--"));
    const [image, as, name] = words;
    const pinned =
      !image ||
      image.toLowerCase() === "scratch" ||
      stages.has(image.toLowerCase()) ||
      DIGEST.test(image);
    if (!pinned) {
      problems.push(`${file}:${index + 1}: FROM ${image} is not pinned by digest (image:tag@sha256:…)`);
    }
    if (as?.toLowerCase() === "as" && name) stages.add(name.toLowerCase());
  });
  return problems;
}

/** Problems in one workflow's `uses:`, `container:` and `image:` lines. */
export function workflowProblems(text, file) {
  const problems = [];
  text.split("\n").forEach((line, index) => {
    const where = `${file}:${index + 1}`;
    const uses = line.match(/^\s*(?:-\s+)?uses:\s*(.+)$/);
    if (uses) {
      const action = yamlValue(uses[1]);
      if (action.startsWith("./")) return;
      if (action.startsWith("docker://")) {
        if (!DIGEST.test(action)) {
          problems.push(`${where}: uses ${action} is not pinned by digest (docker://image:tag@sha256:…)`);
        }
        return;
      }
      if (!COMMIT.test(action)) {
        problems.push(`${where}: uses ${action} is not pinned to a full commit SHA (owner/repo@<sha> # vX.Y.Z)`);
      }
      return;
    }
    const image = line.match(/^\s*(?:-\s+)?(?:image|container):\s*(.+)$/);
    if (!image) return;
    const value = yamlValue(image[1]);
    if (value === "" || value.includes("${{")) return;
    if (!DIGEST.test(value)) {
      problems.push(`${where}: image ${value} is not pinned by digest (image:tag@sha256:…)`);
    }
  });
  return problems;
}

function dockerfiles(root, directory = root) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) found.push(...dockerfiles(root, join(directory, entry.name)));
    } else if (/^Dockerfile(\..+)?$|\.Dockerfile$/.test(entry.name)) {
      found.push(join(directory, entry.name));
    }
  }
  return found;
}

/** Every pin problem under the repository root. */
export function checkPins(root) {
  const problems = [];
  for (const path of dockerfiles(root)) {
    problems.push(...dockerfileProblems(readFileSync(path, "utf8"), relative(root, path)));
  }
  const workflows = join(root, ".github", "workflows");
  if (existsSync(workflows)) {
    for (const name of readdirSync(workflows).sort()) {
      if (!/\.ya?ml$/.test(name)) continue;
      const path = join(workflows, name);
      problems.push(...workflowProblems(readFileSync(path, "utf8"), relative(root, path)));
    }
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = resolve(process.argv[2] ?? ".");
  const problems = checkPins(root);
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) {
    console.error(`\n${problems.length} unpinned build input(s).`);
    process.exit(1);
  }
  console.log("Base images and actions are pinned.");
}
