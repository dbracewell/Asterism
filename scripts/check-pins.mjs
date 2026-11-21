#!/usr/bin/env node
/**
 * Checks that the build pulls only immutable inputs (US-92.1).
 *
 * - A Dockerfile's `syntax` parser directive, and every `FROM` in it, names an
 *   image by digest (`image:tag@sha256:…`); a `FROM` may instead name a stage
 *   declared earlier in the same file, or `scratch`.
 * - Workflows are parsed as YAML, so flow-style steps and comments are read the
 *   way GitHub reads them. Each job's and step's `uses:` names an action or
 *   reusable workflow by full commit SHA (`owner/repo@<40 hex> # vX.Y.Z`), a
 *   local one (`./…`), or a `docker://` image by digest. Each job's `container:`
 *   (or its `image:`) and each service's `image:` names an image by digest; a
 *   value computed by an expression (`${{ … }}`) is not checked.
 * - A layout the check can't read (an alias where a step, job or value belongs,
 *   or invalid YAML) is a problem rather than silently passing.
 *
 * Problems name the file and line. Usage: node scripts/check-pins.mjs [root]
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { LineCounter, isMap, isScalar, isSeq, parseDocument } from "yaml";

const DIGEST = /@sha256:[0-9a-f]{64}$/;
const COMMIT = /@[0-9a-f]{40}$/;
const ignoredDirectories = new Set([".git", "node_modules", ".next", ".venv"]);
const DIRECTIVE = /^\s*#\s*([a-z][a-z0-9_-]*)\s*=\s*(.*?)\s*$/i;

/** Problems in one Dockerfile's `syntax` directive and `FROM` lines. */
export function dockerfileProblems(text, file) {
  const problems = [];
  const lines = text.replace(/^\uFEFF/, "").split("\n");
  // BuildKit reads parser directives only until the first comment, blank line
  // or instruction, so this scans exactly that leading block.
  for (const [index, line] of lines.entries()) {
    const directive = line.match(DIRECTIVE);
    if (!directive) break;
    const [, key, value] = directive;
    if (key.toLowerCase() === "syntax" && !DIGEST.test(value)) {
      problems.push(`${file}:${index + 1}: syntax ${value} is not pinned by digest (image:tag@sha256:…)`);
    }
  }
  const stages = new Set();
  lines.forEach((line, index) => {
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

/** Problems in one workflow's `uses:`, `container:` and service `image:` values. */
export function workflowProblems(text, file) {
  const lineCounter = new LineCounter();
  const document = parseDocument(text, { lineCounter });
  if (document.errors.length > 0) {
    return document.errors.map(
      (error) => `${file}:${error.linePos?.[0]?.line ?? 1}: not valid YAML (${error.code})`,
    );
  }
  const problems = [];
  const where = (node) => `${file}:${lineCounter.linePos(node.range[0]).line}`;
  /** The node as a map, or null when absent; anything else is a problem. */
  const mapping = (node, what) => {
    if (node == null || isMap(node)) return node ?? null;
    if (isScalar(node) && node.value == null) return null;
    problems.push(`${where(node)}: ${what} is not a mapping the pin check can read (aliases are not followed)`);
    return null;
  };
  /** The node's string value, or null when absent; anything else is a problem. */
  const string = (node, what) => {
    if (node == null || (isScalar(node) && node.value == null)) return null;
    if (isScalar(node) && typeof node.value === "string") return node.value.trim();
    problems.push(`${where(node)}: ${what} is not a plain string the pin check can read (aliases are not followed)`);
    return null;
  };
  const checkUses = (node) => {
    const action = string(node, "uses");
    if (action === null || action.startsWith("./")) return;
    if (action.startsWith("docker://")) {
      if (!DIGEST.test(action)) {
        problems.push(`${where(node)}: uses ${action} is not pinned by digest (docker://image:tag@sha256:…)`);
      }
    } else if (!COMMIT.test(action)) {
      problems.push(`${where(node)}: uses ${action} is not pinned to a full commit SHA (owner/repo@<sha> # vX.Y.Z)`);
    }
  };
  const checkImage = (node) => {
    const image = string(node, "image");
    if (image === null || image.includes("${{")) return;
    if (!DIGEST.test(image)) {
      problems.push(`${where(node)}: image ${image} is not pinned by digest (image:tag@sha256:…)`);
    }
  };

  const jobs = mapping(document.get("jobs", true), "jobs");
  for (const { key, value } of jobs?.items ?? []) {
    const job = mapping(value, `job ${key}`);
    if (!job) continue;
    checkUses(job.get("uses", true));
    const container = job.get("container", true);
    if (isMap(container)) checkImage(container.get("image", true));
    else checkImage(container);
    const services = mapping(job.get("services", true), "services");
    for (const service of services?.items ?? []) {
      const definition = mapping(service.value, `service ${service.key}`);
      if (definition) checkImage(definition.get("image", true));
    }
    const steps = job.get("steps", true);
    if (steps == null) continue;
    if (!isSeq(steps)) {
      problems.push(`${where(steps)}: steps is not a list the pin check can read (aliases are not followed)`);
      continue;
    }
    for (const step of steps.items) {
      const definition = mapping(step, "step");
      if (definition) checkUses(definition.get("uses", true));
    }
  }
  const line = (problem) => Number(problem.slice(file.length + 1).split(":")[0]);
  return problems.sort((a, b) => line(a) - line(b));
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
