// The screenshot spec runner (EPIC-106).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { screenshotSpecs } from "../scripts/e2e-screenshots.mjs";

test("finds the specs that compare screenshots, and only those", () => {
  const directory = mkdtempSync(join(tmpdir(), "screenshot-specs-"));
  try {
    writeFileSync(
      join(directory, "b.spec.ts"),
      "await expect(page).toHaveScreenshot('b.png');",
    );
    writeFileSync(
      join(directory, "a.spec.ts"),
      "await expect(x).toHaveScreenshot(\n  'a.png');",
    );
    writeFileSync(
      join(directory, "plain.spec.ts"),
      "await expect(page).toBeVisible();",
    );
    writeFileSync(join(directory, "helper.ts"), "toHaveScreenshot(");
    assert.deepEqual(screenshotSpecs(directory), [
      "e2e/a.spec.ts",
      "e2e/b.spec.ts",
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the repository's screenshot specs include the delegation summary", () => {
  const specs = screenshotSpecs();
  assert.ok(specs.includes("e2e/delegation-summary.spec.ts"), specs.join(", "));
  assert.ok(specs.length >= 5, specs.join(", "));
});
