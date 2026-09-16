import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ setConfig: vi.fn(), request: vi.fn() }));
vi.mock("@/lib/auth-client", () => ({ authClient: {} }));
vi.mock("@/lib/client", () => ({ ApiClient: class {} }));
vi.mock("@/lib/client/client.gen", () => ({
  client: {
    setConfig: mocks.setConfig,
    interceptors: { request: { use: mocks.request } },
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
});

it("uses the browser origin without URL environment variables", async () => {
  await import("./api");
  expect(mocks.setConfig).toHaveBeenCalledWith({
    baseUrl: `${window.location.origin}/api/py`,
    throwOnError: true,
  });
});

it("uses loopback when evaluated during server rendering", async () => {
  vi.stubGlobal("window", undefined);
  await import("./api");
  expect(mocks.setConfig).toHaveBeenCalledWith({
    baseUrl: "http://127.0.0.1:8000/api/py",
    throwOnError: true,
  });
});
