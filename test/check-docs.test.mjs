// The documentation link check (US-87.1).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  anchorsOf,
  checkDocs,
  linksOf,
  slugify,
} from "../scripts/check-docs.mjs";

test("headings slug the way GitHub does", () => {
  assert.equal(slugify("Search indexes"), "search-indexes");
  assert.equal(
    slugify("Run usage and cost (US-54.1)"),
    "run-usage-and-cost-us-541",
  );
  assert.equal(slugify("`load_skill` and **skills**"), "load_skill-and-skills");
  assert.equal(slugify("[Linked](x.md) heading"), "linked-heading");
});

test("repeated headings get numbered anchors and code fences are ignored", () => {
  const anchors = anchorsOf(
    [
      "# Limits",
      "## Limits",
      "```",
      "# Not a heading",
      "```",
      '<a id="custom"></a>',
    ].join("\n"),
  );
  assert.deepEqual([...anchors].sort(), ["custom", "limits", "limits-1"]);
});

test("links are found outside code, including parenthesized and angle paths", () => {
  const links = linksOf(
    [
      "See [a](a.md#x) and ![img](images/one.png).",
      "`[not](code.md)`",
      "[auth](<app/(auth)/page.tsx>) and [bare](app/(main)/page.tsx)",
      "[ref]: ref.md",
      "```",
      "[fenced](fenced.md)",
      "```",
    ].join("\n"),
  );
  assert.deepEqual(
    links.map((link) => link.target),
    [
      "a.md#x",
      "images/one.png",
      "app/(auth)/page.tsx",
      "app/(main)/page.tsx",
      "ref.md",
    ],
  );
});

test("broken files and anchors are reported; external and archived links are not", () => {
  const root = mkdtempSync(join(tmpdir(), "asterism-docs-"));
  try {
    mkdirSync(join(root, "docs", "archive"), { recursive: true });
    writeFileSync(join(root, "docs", "guide.md"), "# Guide\n\n## Steps\n");
    writeFileSync(
      join(root, "README.md"),
      [
        "[ok](docs/guide.md#steps)",
        "[self](#readme)",
        "[web](https://example.com/missing)",
        "[gone](docs/missing.md)",
        "[bad anchor](docs/guide.md#nowhere)",
        "# Readme",
      ].join("\n"),
    );
    writeFileSync(
      join(root, "docs", "archive", "old.md"),
      "[stale](nothing.md)",
    );
    assert.deepEqual(checkDocs(root), [
      "README.md:4: missing file docs/missing.md",
      "README.md:5: missing anchor #nowhere in docs/guide.md",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
