import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";

// US-41.4: feature code uses shape tiers (rounded-control/surface/overlay,
// rounded-chip for chips, rounded-dot for indicators) and elevation levels
// (shadow-raised/overlay). Only components/ui may use the raw Tailwind scale.
const root = join(process.cwd(), "src");
const skipped = ["components/ui", "lib/client", "features/theme"];
const adHoc =
  /(?<![\w.-])(?:[\w-]+:|\[[^\]]+\]:)*!?(rounded(?:-(?:t|r|b|l|s|e|tl|tr|br|bl|ss|se|es|ee))?(?:-(?:xs|sm|md|lg|xl|2xl|3xl|4xl|full|\[(?!inherit\])[^\]]+\]))?|shadow(?:-(?:2xs|xs|sm|md|lg|xl|2xl|\[[^\]]+\]))?)!?(?![\w-]|\s*[:=?(])/g;

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    const rel = relative(root, path);
    if (skipped.includes(rel)) return [];
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)
      ? [path]
      : [];
  });
}

it("uses shape and elevation tokens instead of ad-hoc radius/shadow classes", () => {
  const findings = files(root).flatMap((path) =>
    readFileSync(path, "utf8")
      .split("\n")
      .flatMap((line, index) =>
        [...line.matchAll(adHoc)]
          // A quoted bare word ("shadow") is a field name, not a class list.
          .filter(
            (match) =>
              !(
                line[match.index - 1] === '"' &&
                line[match.index + match[0].length] === '"'
              ),
          )
          .map((match) => `${relative(root, path)}:${index + 1} ${match[0]}`),
      ),
  );
  expect(findings).toEqual([]);
});

it("flags raw scale classes and allows tokens", () => {
  const hits = (text: string) =>
    [...text.matchAll(adHoc)].map((match) => match[1]);
  expect(
    hits(
      '"rounded rounded-md md:rounded-t-lg shadow hover:shadow-md rounded-full! rounded-[4px] shadow-[0_0_1px]"',
    ),
  ).toEqual([
    "rounded",
    "rounded-md",
    "rounded-t-lg",
    "shadow",
    "shadow-md",
    "rounded-full",
    "rounded-[4px]",
    "shadow-[0_0_1px]",
  ]);
  expect(
    hits(
      '"rounded-control rounded-t-surface rounded-overlay rounded-chip rounded-dot rounded-none rounded-[inherit] shadow-raised focus-within:shadow-overlay shadow-none text-shadow-2xs drop-shadow-md"',
    ),
  ).toEqual([]);
  expect(hits("{ shadow: true, rounded = 1, shadow ? a : b }")).toEqual([]);
});
