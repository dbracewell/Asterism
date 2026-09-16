// Next 16.2 still exports this helper under its pre-Proxy name.
import { unstable_doesMiddlewareMatch as unstable_doesProxyMatch } from "next/experimental/testing/server";
import { expect, it, vi } from "vitest";
import { config } from "./proxy";

vi.mock("@/lib/auth", () => ({ auth: {} }));

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
