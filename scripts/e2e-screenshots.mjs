#!/usr/bin/env node
// Runs every E2E spec that compares screenshots (EPIC-106).
//
//   pnpm test:e2e:screenshots                     compare against the baselines
//   pnpm test:e2e:screenshots --update-snapshots  refresh them, then review the diff
//
// The baselines are macOS renders and CI skips the comparisons on Linux
// (`ignoreSnapshots` in playwright.config.ts), so run this on macOS after any
// update that moves Playwright or its Chromium. Extra arguments go to Playwright.
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The spec files in `directory` that call `toHaveScreenshot`, as `e2e/…` paths. */
export function screenshotSpecs(directory = join(root, "apps/frontend/e2e")) {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".spec.ts"))
    .filter((name) =>
      readFileSync(join(directory, name), "utf8").includes("toHaveScreenshot("),
    )
    .sort()
    .map((name) => `e2e/${name}`);
}

function main() {
  if (process.platform !== "darwin") {
    console.error(
      "Screenshot baselines are macOS renders; on this platform Playwright skips the comparisons. Run this on macOS.",
    );
    process.exit(1);
  }
  const specs = screenshotSpecs();
  console.log(`Screenshot specs: ${specs.join(", ")}`);
  const result = spawnSync(
    process.execPath,
    [
      join(root, "scripts/run-isolated-e2e.mjs"),
      "--workers=1",
      ...specs,
      ...process.argv.slice(2),
    ],
    { cwd: root, stdio: "inherit" },
  );
  process.exit(result.status ?? 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
