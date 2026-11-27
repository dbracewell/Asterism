#!/usr/bin/env node
// US-118.1: print one version's release notes, as its GitHub Release page shows
// them. The release workflow runs it after the image is published:
//
//   node scripts/release-page.mjs <version> > notes.md

import { readFileSync } from "node:fs";
import { posix } from "node:path";
import { pathToFileURL } from "node:url";

import { RELEASE_NOTES, releaseNotesFor } from "./release.mjs";

/**
 * Links in the release notes are relative to docs/; on a Release page they
 * point at that version's files on GitHub instead. Absolute URLs and #anchors
 * stay as they are.
 */
export function absoluteLinks(body, version, repository) {
  return body.replace(/\]\(([^)\s]+)\)/g, (link, target) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target)) return link;
    const path = posix.normalize(posix.join("docs", target));
    return `](https://github.com/${repository}/blob/v${version}/${path})`;
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [version] = process.argv.slice(2);
  if (!version) {
    console.error("Usage: node scripts/release-page.mjs <version>");
    process.exit(2);
  }
  try {
    const repository = process.env.GITHUB_REPOSITORY ?? "dbracewell/Asterism";
    const body = releaseNotesFor(readFileSync(RELEASE_NOTES, "utf8"), version);
    process.stdout.write(absoluteLinks(body, version, repository));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
