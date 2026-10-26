import { describe, expect, it } from "vitest";
import { themeDataSchema } from "../schemas";
import { themeToCssVariables } from "./utils";

const colors = { background: "#ffffff", foreground: "#000000" } as never;

describe("theme shape variables", () => {
  it("falls back to Atlas for every omitted shape value", () => {
    expect(themeToCssVariables({ colors })).toMatchObject({
      "--background": "#ffffff",
      "--radius": "0.45rem",
      "--elevation": "1",
      "--spacing": "0.25rem",
    });
  });
  it("maps explicit radius, flat shadow and compact density", () => {
    expect(
      themeToCssVariables({
        colors,
        radius: 0,
        shadow: "flat",
        density: "compact",
      }),
    ).toMatchObject({
      "--radius": "0rem",
      "--elevation": "0",
      "--spacing": "0.225rem",
    });
  });
});

describe("theme shape validation", () => {
  const base = { name: "Shape", type: "light", colors: {} };
  const shape = themeDataSchema.pick({
    radius: true,
    shadow: true,
    density: true,
  });
  it.each([
    { radius: 0 },
    { radius: 1.25 },
    { shadow: "flat" },
    { density: "compact" },
    {},
  ])("accepts %j", (value) => {
    expect(shape.safeParse(value).success).toBe(true);
  });
  it.each([
    { radius: -0.1 },
    { radius: 1.3 },
    { radius: Number.POSITIVE_INFINITY },
    { radius: Number.NaN },
    { radius: "0.5rem" },
    { radius: "calc(1rem)" },
    { shadow: "hard" },
    { shadow: "0 0 10px red" },
    { density: "spacious" },
    { density: null },
  ])("rejects %j", (value) => {
    expect(shape.safeParse(value).success).toBe(false);
    expect(themeDataSchema.safeParse({ ...base, ...value }).success).toBe(
      false,
    );
  });
});
