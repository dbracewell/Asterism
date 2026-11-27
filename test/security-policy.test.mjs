import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// US-117.3: the security policy names the minor that gets fixes, so it must
// move with the app version.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("SECURITY.md names the current minor as the supported one", () => {
  const [major, minor] = JSON.parse(read("package.json")).version.split(".");
  const current = `${major}.${minor}`;
  const policy = read("SECURITY.md");
  assert.match(policy, new RegExp(`today that is ${current.replace(".", "\\.")}\\.`));
  assert.match(policy, new RegExp(`\\| ${current.replace(".", "\\.")}\\.x \\(latest\\)`));
});

test("a release moves the supported minor; a patch release leaves it", async () => {
  const { updateSecurityPolicy } = await import("../scripts/release.mjs");
  const policy = read("SECURITY.md");
  const next = updateSecurityPolicy(policy, "0.6.0");
  assert.match(next, /today that is 0\.6\./);
  assert.match(next, /\| 0\.6\.x \(latest\)  \| Yes   \|\n\| 0\.5\.x and older \| No    \|/);
  const [major, minor] = JSON.parse(read("package.json")).version.split(".");
  assert.equal(updateSecurityPolicy(policy, `${major}.${minor}.9`), policy);
});
