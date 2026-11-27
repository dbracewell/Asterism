import { describe, expect, it } from "vitest";
import { safeDecodeURIComponent } from "./safe-decode";

describe("safeDecodeURIComponent (US-117.2)", () => {
  it("decodes names with an encoded percent sign", () => {
    expect(safeDecodeURIComponent(encodeURIComponent("50% off.pdf"))).toBe(
      "50% off.pdf",
    );
  });

  it("returns null for malformed escapes instead of throwing", () => {
    for (const value of ["%ZZ", "100%", "%E0%A4%A"])
      expect(safeDecodeURIComponent(value)).toBeNull();
  });
});
