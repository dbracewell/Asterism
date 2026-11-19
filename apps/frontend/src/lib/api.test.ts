import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setConfig: vi.fn(),
  request: vi.fn(),
  response: vi.fn(),
  forget: vi.fn(),
}));
vi.mock("@/lib/auth-client", () => ({ authClient: {} }));
vi.mock("@/lib/backend-token", () => ({
  backendToken: vi.fn(),
  forgetBackendToken: mocks.forget,
}));
vi.mock("@/lib/client", () => ({ ApiClient: class {} }));
vi.mock("@/lib/client/client.gen", () => ({
  client: {
    setConfig: mocks.setConfig,
    interceptors: {
      request: { use: mocks.request },
      response: { use: mocks.response },
    },
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

async function onResponse(status: number) {
  await import("./api");
  const [interceptor] = mocks.response.mock.calls[0];
  return interceptor(new Response(null, { status }));
}

it("forgets the cached token when the backend rejects it (401)", async () => {
  await onResponse(401);
  expect(mocks.forget).toHaveBeenCalledOnce();
});

it("keeps the cached token when a signed-in person is not allowed (403)", async () => {
  const response = await onResponse(403);
  expect(response.status).toBe(403);
  expect(mocks.forget).not.toHaveBeenCalled();
});
