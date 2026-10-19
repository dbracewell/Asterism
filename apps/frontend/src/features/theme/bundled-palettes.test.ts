import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { themeColorsSchema, themeDataSchema, themeIdSchema } from "./schemas";
import { contrastRatio, themeTextPairs } from "./contrast";
vi.mock("server-only", () => ({}));
import { bundledThemes } from "./bundled";

// Enumerate source files too: adding a JSON without registering it must fail CI.
const directory = join(process.cwd(), "src/features/theme/bundled");
const ids = readdirSync(directory)
  .filter((file) => file.endsWith(".json"))
  .map((file) => file.slice(0, -5))
  .sort();

it("registers every bundled palette exactly once", () => {
  expect(Object.keys(bundledThemes).sort()).toEqual(ids);
  expect(ids.length).toBeGreaterThan(0);
});
it("covers every declared foreground role", () => {
  expect(themeTextPairs.map(([foreground]) => foreground).sort()).toEqual(
    Object.keys(themeColorsSchema.shape)
      .filter((key) => key === "foreground" || key.endsWith("-foreground"))
      .sort(),
  );
});
for (const id of ids) {
  describe(id, () => {
    const raw = JSON.parse(readFileSync(join(directory, `${id}.json`), "utf8"));
    it("has a catalog ID and strict complete theme schema", () => {
      expect(themeIdSchema.safeParse(id).success).toBe(true);
      const result = themeDataSchema.safeParse(raw);
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    });
    it.each(themeTextPairs)(
      "%s on %s meets 4.5:1 without rounding",
      (foreground, background) => {
        const ratio = contrastRatio(
          raw.colors[foreground],
          raw.colors[background],
        );
        expect(
          ratio,
          `${id}: ${foreground} ${raw.colors[foreground]} / ${background} ${raw.colors[background]} = ${ratio}:1; minimum 4.5:1`,
        ).toBeGreaterThanOrEqual(4.5);
      },
    );
  });
}

describe("contrast calculation boundaries", () => {
  it("matches reference extremes and shorthand", () => {
    expect(contrastRatio("#000", "#fff")).toBe(21);
    expect(contrastRatio("#abcdef", "#abcdef")).toBe(1);
    expect(contrastRatio("#abc", "#fff")).toBe(
      contrastRatio("#aabbcc", "#ffffff"),
    );
  });
  it("does not round a near-threshold failure into a pass", () => {
    const ratio = contrastRatio("#777777", "#ffffff");
    expect(ratio).toBeLessThan(4.5);
    expect(ratio.toFixed(1)).toBe("4.5");
    expect(contrastRatio("#767676", "#ffffff")).toBeGreaterThan(4.5);
  });
  it.each(["red", "#abcd", "#00000000", "#gggggg"])(
    "rejects unsupported color %s",
    (color) => {
      expect(() => contrastRatio(color, "#ffffff")).toThrow("opaque hex");
    },
  );
});
