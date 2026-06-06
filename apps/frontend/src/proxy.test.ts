import { describe, expect, it } from "vitest";

import { getSetupRedirectPath } from "@/proxy";

describe("getSetupRedirectPath", () => {
  it("redirects app routes to setup when setup is required", () => {
    expect(getSetupRedirectPath("/app", true)).toBe("/app/setup");
    expect(getSetupRedirectPath("/app/settings", true)).toBe("/app/setup");
  });

  it("keeps setup routes accessible when setup is required", () => {
    expect(getSetupRedirectPath("/app/setup", true)).toBeNull();
    expect(getSetupRedirectPath("/app/setup/extra", true)).toBeNull();
  });

  it("redirects setup route back to app when setup is complete", () => {
    expect(getSetupRedirectPath("/app/setup", false)).toBe("/app");
  });

  it("does not redirect normal app routes when setup is complete", () => {
    expect(getSetupRedirectPath("/app", false)).toBeNull();
    expect(getSetupRedirectPath("/app/chat", false)).toBeNull();
  });
});
