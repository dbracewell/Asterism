import { afterEach, expect, it, vi } from "vitest";
import { getClient } from "./api-server";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getToken: vi.fn(async () => ({ token: "test-jwt" })) } },
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/client", () => ({ ApiClient: class {} }));
vi.mock("@/lib/client/client", () => ({
  createClient: mocks.createClient,
  createConfig: (config: unknown) => config,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it("uses loopback and forwards the JWT without URL environment variables", async () => {
  await getClient();
  expect(mocks.createClient).toHaveBeenCalledWith({
    baseUrl: "http://127.0.0.1:8000/api/py",
    headers: { Authorization: "Bearer test-jwt" },
  });
});
