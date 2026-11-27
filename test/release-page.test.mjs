import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { releaseNotesFor } from "../scripts/release.mjs";

const NOTES = `# Release notes

## Unreleased

- Not released yet.

## 0.3.0 (2026-11-22)

### Image

- Newer.

## 0.2.2 (2026-11-22)

### Behavior

- Older.
`;

test("a release page shows that version's notes, without the heading", () => {
  assert.equal(releaseNotesFor(NOTES, "0.3.0"), "### Image\n\n- Newer.\n");
  assert.equal(releaseNotesFor(NOTES, "0.2.2"), "### Behavior\n\n- Older.\n");
  assert.throws(() => releaseNotesFor(NOTES, "0.9.0"), /no section for 0\.9\.0/);
  // "0.3.0" must not match "0.3.01" or "0x3y0".
  assert.throws(() => releaseNotesFor(NOTES.replace("0.3.0", "0x3y0"), "0.3.0"), /no section/);
  assert.throws(
    () => releaseNotesFor("## 0.4.0 (2026-11-23)\n\n## 0.3.0 (2026-11-22)\n- x\n", "0.4.0"),
    /empty/,
  );
});

test("every tagged release in the notes has a page body", () => {
  const notes = readFileSync(new URL("../docs/release-notes.md", import.meta.url), "utf8");
  const versions = [...notes.matchAll(/^## (\d+\.\d+\.\d+) \(/gm)].map((match) => match[1]);
  assert.ok(versions.length >= 5);
  for (const version of versions) assert.match(releaseNotesFor(notes, version), /^### /);
});

test("only the release-page job can write to the repository, and only after publishing", () => {
  const workflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  const jobs = workflow.split(/\n  (?=[a-z-]+:\n)/).slice(1);
  const page = jobs.find((job) => job.startsWith("release-page:"));
  assert.ok(page, "the release-page job exists");
  assert.match(page, /needs: \[version, publish\]/);
  assert.match(page, /if: github\.event_name == 'push' && github\.ref_type == 'tag'/);
  assert.match(page, /contents: write/);
  for (const job of jobs.filter((job) => job !== page)) assert.doesNotMatch(job, /contents: write/);
});
