import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";

// US-41.6: UI colors come from theme tokens. Tailwind palette colors are banned
// everywhere; literal colors are allowed only where themes are defined/edited.
const root = join(process.cwd(), "src");
const palette =
  /(?<![\w-])(?:[\w-]+:)*(?:text|bg|border(?:-[trblxyse])?|ring|ring-offset|outline|from|via|to|fill|stroke|decoration|divide|accent|caret|placeholder|shadow)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|black|white)(?:-\d{2,3})?(?![\w-])/;
const literal = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(/;
const literalAllowed = [
  "features/theme",
  "features/settings/ui/admin-settings/theme-editor.tsx",
];

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

function findings(pattern: RegExp, allowed: string[] = []) {
  return files(root)
    .filter((path) => !allowed.some((a) => relative(root, path).startsWith(a)))
    .flatMap((path) =>
      readFileSync(path, "utf8")
        .split("\n")
        .flatMap((line, index) =>
          pattern.test(line) ? [`${relative(root, path)}:${index + 1}`] : [],
        ),
    );
}

it("uses theme tokens instead of Tailwind palette colors", () => {
  expect(findings(palette)).toEqual([]);
});

it("keeps literal colors inside theme definitions and the theme editor", () => {
  expect(findings(literal, literalAllowed)).toEqual([]);
});

it("flags palette utilities and literal colors", () => {
  for (const sample of [
    "border-amber-500/40",
    "dark:bg-amber-950/20",
    "bg-black/80",
    "text-white",
  ]) {
    expect(palette.test(`className="${sample}"`)).toBe(true);
  }
  expect(palette.test('className="bg-scrim text-primary"')).toBe(false);
  expect(literal.test('fill="#3B5BDB"')).toBe(true);
  expect(literal.test("color: rgb(0 0 0)")).toBe(true);
  expect(literal.test('href="#section-2"')).toBe(false);
});
