import { describe, expect, it } from "vitest";

import { formatURL } from "@/lib/utils";

describe("formatURL", () => {
  it("builds a URL with scalar params", () => {
    const result = formatURL("/app", {
      mode: "signup",
      redirect: "/app/settings",
    });

    expect(result).toBe("/app/?mode=signup&redirect=%2Fapp%2Fsettings");
  });

  it("omits empty values and trims whitespace", () => {
    const result = formatURL("/app", {
      mode: "  login  ",
      empty: "   ",
      nullable: null,
      undef: undefined,
    });

    expect(result).toBe("/app/?mode=login");
  });

  it("joins array values with commas", () => {
    const result = formatURL("/app", {
      tags: ["alpha", "beta"],
    });

    expect(result).toBe("/app/?tags=alpha%2Cbeta");
  });
});
