import { describe, expect, it } from "vitest";
import { sanitizeRedirectPath, signInRedirectPath } from "./redirect";

describe("signInRedirectPath", () => {
  it("returns the sanitized redirect with its query string", () => {
    expect(signInRedirectPath({ redirect: "/chat/abc?tab=files" })).toBe(
      "/chat/abc?tab=files",
    );
  });

  it("uses the first of a repeated redirect", () => {
    expect(signInRedirectPath({ redirect: ["/settings", "/admin"] })).toBe(
      "/settings",
    );
  });

  it("falls back home for missing, empty, unsafe or malformed values", () => {
    expect(signInRedirectPath({})).toBe("/");
    expect(signInRedirectPath({ redirect: [] })).toBe("/");
    expect(signInRedirectPath({ redirect: "//evil.example" })).toBe("/");
    expect(signInRedirectPath({ redirect: ["https://evil.example"] })).toBe(
      "/",
    );
    expect(signInRedirectPath(null)).toBe("/");
    expect(signInRedirectPath({ redirect: 42 })).toBe("/");
  });

  it("matches sanitizeRedirectPath for a single value", () => {
    expect(signInRedirectPath({ redirect: "/sign-in" })).toBe(
      sanitizeRedirectPath("/sign-in"),
    );
  });
});
