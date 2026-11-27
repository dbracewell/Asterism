import { afterEach, describe, expect, it, vi } from "vitest";

const set = vi.hoisted(() => vi.fn());
vi.mock("js-cookie", () => ({ default: { set } }));

import { allowedFontSize, FONT_SIZES } from "@/features/theme/constants";
import { setPreferenceCookie } from "./preference-cookie";

describe("preference cookies (US-116.2)", () => {
  afterEach(() => {
    set.mockReset();
    vi.unstubAllGlobals();
  });

  it("are site-wide and SameSite=Lax, Secure only over HTTPS", () => {
    setPreferenceCookie("asterism-font-size", "18px", 365);
    expect(set).toHaveBeenLastCalledWith("asterism-font-size", "18px", {
      path: "/",
      sameSite: "lax",
      secure: false,
      expires: 365,
    });
    vi.stubGlobal("location", { protocol: "https:" });
    setPreferenceCookie("asterism-sidebar-width", "20rem");
    expect(set).toHaveBeenLastCalledWith("asterism-sidebar-width", "20rem", {
      path: "/",
      sameSite: "lax",
      secure: true,
    });
  });
});

describe("allowedFontSize", () => {
  it("keeps only the offered sizes", () => {
    for (const size of FONT_SIZES) expect(allowedFontSize(size)).toBe(size);
    for (const value of ["15px", "1rem", "16px;color:red", "", null, undefined])
      expect(allowedFontSize(value)).toBe("16px");
  });
});
