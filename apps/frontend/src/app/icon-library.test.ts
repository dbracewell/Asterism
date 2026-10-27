import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";

// US-41.5: Lucide is the only icon set, and its stroke width is set once by
// LucideProvider in app/providers.tsx.
const root = join(process.cwd(), "src");
const otherIconSet =
  /from "(@tabler\/icons-react|react-icons[^"]*|@heroicons\/[^"]*|@phosphor-icons\/[^"]*|@radix-ui\/react-icons)"/;
const iconStroke = /<\w+Icon\b[^>]*\b(?:absoluteS|s)trokeWidth=/;

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (relative(root, path) === "lib/client") return [];
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)
      ? [path]
      : [];
  });
}

function findings(pattern: RegExp) {
  return files(root).flatMap((path) =>
    readFileSync(path, "utf8")
      .split("\n")
      .flatMap((line, index) =>
        pattern.test(line) ? [`${relative(root, path)}:${index + 1}`] : [],
      ),
  );
}

it("imports icons only from lucide-react", () => {
  expect(findings(otherIconSet)).toEqual([]);
});

it("leaves icon stroke width to LucideProvider", () => {
  expect(findings(iconStroke)).toEqual([]);
});

it("flags other icon sets and per-icon stroke widths", () => {
  expect(
    otherIconSet.test('import { IconBrain } from "@tabler/icons-react";'),
  ).toBe(true);
  expect(iconStroke.test("<BrainIcon strokeWidth={1.5} />")).toBe(true);
  expect(iconStroke.test("<g stroke={fill} strokeWidth={strokeWidth}>")).toBe(
    false,
  );
});

it("depends on no other icon package", () => {
  const { dependencies = {} } = JSON.parse(
    readFileSync(join(process.cwd(), "package.json"), "utf8"),
  ) as { dependencies?: Record<string, string> };
  expect(
    Object.keys(dependencies).filter((name) => /icon/i.test(name)),
  ).toEqual([]);
});
