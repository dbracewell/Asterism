// Next 16.2 still exports this helper under its pre-Proxy name.
import { unstable_doesMiddlewareMatch as unstable_doesProxyMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";
import { config, proxy } from "./proxy";

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("@/lib/auth", () => ({
  getAuth: () => ({
    api: {
      getSession: vi.fn(async () => null),
    },
  }),
}));

vi.mock("@/lib/server-config-core", () => ({
  getFrontendServerConfig: () => ({
    publicUrl: "http://localhost:3000",
  }),
}));

it.each([
  "/api/py",
  "/api/py/settings/user",
  "/api/py/chat/stream/test?token=test",
])("leaves backend authentication to FastAPI for %s", (url) =>
  expect(unstable_doesProxyMatch({ config, nextConfig: {}, url })).toBe(false),
);

it.each(["/", "/settings", "/api/pyramid"])("still guards %s", (url) => {
  expect(unstable_doesProxyMatch({ config, nextConfig: {}, url })).toBe(true);
});

it("ignores spoofed x-forwarded-host headers when building sign-in redirects", async () => {
  const req = new NextRequest("http://localhost:3000/settings", {
    headers: {
      "x-forwarded-proto": "https",
      "x-forwarded-host": "evil.example",
    },
  });
  const res = await proxy(req);
  expect(res.headers.get("location")).toBe(
    "http://localhost:3000/sign-in?redirect=%2Fsettings",
  );
});
