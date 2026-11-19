#!/usr/bin/env node
/**
 * Checks relative links in the repository's Markdown documentation.
 *
 * Every relative link and image in docs/ and the maintained READMEs and agent
 * playbooks listed below must point at a file or
 * directory that exists, and a link with a `#fragment` into a Markdown file must
 * name a heading (GitHub-style slug) or an explicit `<a id>` anchor in it.
 * External links (http, mailto and similar) are not fetched.
 *
 * Usage: node scripts/check-docs.mjs [repository root]
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ignoredDirectories = new Set([".git", "node_modules"]);
/**
 * Maintained documents outside docs/. CLAUDE.md is a symlink to AGENTS.md, and
 * codebase_review.md is a dated review kept as written.
 */
const ENTRY_DOCUMENTS = [
  "README.md",
  "AGENTS.md",
  "todo.md",
  "apps/backend/README.md",
  "apps/frontend/README.md",
  "apps/frontend/AGENTS.md",
  "scripts/README.md",
];
/** Dated records are evidence as written; their links are not maintained. */
const historicalDirectories = new Set(["archive"]);

/** Removes fenced code blocks and inline code, keeping line numbers. */
export function stripCode(markdown) {
  const lines = markdown.split("\n");
  let fence = null;
  return lines
    .map((line) => {
      const opening = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (fence) {
        if (
          opening &&
          opening[1][0] === fence[0] &&
          opening[1].length >= fence.length
        ) {
          fence = null;
        }
        return "";
      }
      if (opening) {
        fence = opening[1];
        return "";
      }
      return line.replace(/(`+)[\s\S]*?\1/g, "");
    })
    .join("\n");
}

/** GitHub's heading slug: lower case, punctuation dropped, spaces to hyphens. */
export function slugify(heading) {
  return heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[*`]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** Every anchor a Markdown document defines: heading slugs and `<a id>`/`<a name>`. */
export function anchorsOf(markdown) {
  const anchors = new Set();
  const seen = new Map();
  let fence = null;
  for (const line of markdown.split("\n")) {
    const opening = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (
        opening &&
        opening[1][0] === fence[0] &&
        opening[1].length >= fence.length
      )
        fence = null;
      continue;
    }
    if (opening) {
      fence = opening[1];
      continue;
    }
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/);
    if (heading) {
      const base = slugify(heading[1]);
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      anchors.add(count === 0 ? base : `${base}-${count}`);
    }
    for (const match of line.matchAll(
      /<a\s+[^>]*(?:id|name)\s*=\s*["']([^"']+)["']/gi,
    )) {
      anchors.add(match[1]);
    }
  }
  return anchors;
}

/** Link targets in a document, with their line numbers. */
export function linksOf(markdown) {
  const links = [];
  stripCode(markdown)
    .split("\n")
    .forEach((line, index) => {
      const lineNumber = index + 1;
      // A target is either `<...>` (may hold spaces and parentheses) or a bare
      // path whose parentheses are balanced, as in `app/(auth)/page.tsx`.
      const inline =
        /!?\[(?:[^\]\\]|\\.)*\]\(\s*(?:<([^>]+)>|((?:[^()\s]|\([^()\s]*\))+))(?:\s+["'][^"']*["'])?\s*\)/g;
      for (const match of line.matchAll(inline)) {
        links.push({ target: match[1] ?? match[2], line: lineNumber });
      }
      const reference = line.match(/^\s{0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s|$)/);
      if (reference) links.push({ target: reference[1], line: lineNumber });
      for (const match of line.matchAll(
        /<img\s+[^>]*src\s*=\s*["']([^"']+)["']/gi,
      )) {
        links.push({ target: match[1], line: lineNumber });
      }
    });
  return links;
}

const isExternal = (target) =>
  /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//");

function markdownFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (ignoredDirectories.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!historicalDirectories.has(entry.name)) visit(path);
      } else if (entry.name.endsWith(".md")) files.push(path);
    }
  };
  for (const path of ENTRY_DOCUMENTS) {
    if (existsSync(join(root, path))) files.push(join(root, path));
  }
  if (existsSync(join(root, "docs"))) visit(join(root, "docs"));
  return files;
}

/** Returns one problem string per broken link under `root`. */
export function checkDocs(root) {
  const anchorCache = new Map();
  const anchorsFor = (path) => {
    if (!anchorCache.has(path))
      anchorCache.set(path, anchorsOf(readFileSync(path, "utf8")));
    return anchorCache.get(path);
  };
  const problems = [];
  for (const file of markdownFiles(root)) {
    const where = (line) => `${relative(root, file)}:${line}`;
    for (const { target, line } of linksOf(readFileSync(file, "utf8"))) {
      if (isExternal(target)) continue;
      const hashIndex = target.indexOf("#");
      const pathPart = hashIndex === -1 ? target : target.slice(0, hashIndex);
      const fragment = hashIndex === -1 ? "" : target.slice(hashIndex + 1);
      let decoded;
      try {
        decoded = decodeURIComponent(pathPart);
      } catch {
        problems.push(`${where(line)}: malformed link ${target}`);
        continue;
      }
      const destination =
        pathPart === "" ? file : resolve(dirname(file), decoded);
      if (!existsSync(destination)) {
        problems.push(`${where(line)}: missing file ${target}`);
        continue;
      }
      if (
        !fragment ||
        !destination.endsWith(".md") ||
        statSync(destination).isDirectory()
      )
        continue;
      const anchor = decodeURIComponent(fragment).toLowerCase();
      if (!anchorsFor(destination).has(anchor)) {
        problems.push(
          `${where(line)}: missing anchor #${fragment} in ${relative(root, destination)}`,
        );
      }
    }
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = resolve(process.argv[2] ?? ".");
  const problems = checkDocs(root);
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) {
    console.error(`\n${problems.length} broken documentation link(s).`);
    process.exit(1);
  }
  console.log("Documentation links are valid.");
}
