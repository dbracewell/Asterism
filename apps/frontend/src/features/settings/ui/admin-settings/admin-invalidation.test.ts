import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

// EPIC-96: an admin save must reach what people see, without a reload. Each
// admin settings mutation either invalidates everything (no `meta`), lists the
// availability query in `meta.invalidates`, or is exempt here with a reason.
const directory = join(
  process.cwd(),
  "src/features/settings/ui/admin-settings",
);

/** `file:mutation` → why it need not reach the availability query. */
const EXEMPT: Record<string, string> = {
  "component-settings.tsx:test": "a connection test changes no setting",
  "export-settings.tsx:exportSettings": "an export changes no setting",
  "image-gen-settings.tsx:test": "a test image changes no setting",
  "import-settings.tsx:preview": "a preview changes no setting",
  "user-account-actions.tsx:reset": "a reset link changes no setting",
};

/** Each `const name = useMutation(...)` call with its argument text. */
function mutations(source: string): { name: string; body: string }[] {
  const found: { name: string; body: string }[] = [];
  const start = /const (\w+) = useMutation\(/g;
  for (let match = start.exec(source); match; match = start.exec(source)) {
    let depth = 1;
    let index = start.lastIndex;
    while (depth > 0 && index < source.length) {
      if (source[index] === "(") depth += 1;
      if (source[index] === ")") depth -= 1;
      index += 1;
    }
    found.push({ name: match[1], body: source.slice(start.lastIndex, index) });
  }
  return found;
}

const sources = readdirSync(directory)
  .filter((name) => name.endsWith(".tsx") && !name.includes(".test."))
  .map((name) => ({
    name,
    source: readFileSync(join(directory, name), "utf8"),
  }));

it("finds the admin settings mutations", () => {
  const count = sources.flatMap(({ source }) => mutations(source)).length;
  expect(count).toBeGreaterThan(20);
});

it("every admin save reaches the availability query", () => {
  const missing: string[] = [];
  for (const { name, source } of sources) {
    for (const mutation of mutations(source)) {
      const key = `${name}:${mutation.name}`;
      const narrowed =
        mutation.body.includes("invalidates:") ||
        mutation.body.includes("skipGlobalInvalidation");
      if (!narrowed || key in EXEMPT) continue;
      if (!mutation.body.includes("availabilityQueryKey()")) missing.push(key);
    }
  }
  expect(missing).toEqual([]);
});

it("lists no exemption that no longer exists", () => {
  const keys = new Set(
    sources.flatMap(({ name, source }) =>
      mutations(source).map((mutation) => `${name}:${mutation.name}`),
    ),
  );
  expect(Object.keys(EXEMPT).filter((key) => !keys.has(key))).toEqual([]);
});
