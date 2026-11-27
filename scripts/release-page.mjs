#!/usr/bin/env node
// US-118.1: print one version's release notes, as its GitHub Release page shows
// them. The release workflow runs it after the image is published:
//
//   node scripts/release-page.mjs <version> > notes.md

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { RELEASE_NOTES, releaseNotesFor } from "./release.mjs";

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [version] = process.argv.slice(2);
  if (!version) {
    console.error("Usage: node scripts/release-page.mjs <version>");
    process.exit(2);
  }
  try {
    process.stdout.write(releaseNotesFor(readFileSync(RELEASE_NOTES, "utf8"), version));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
