import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ token: vi.fn() }));
vi.mock("@/lib/auth-client", () => ({ authClient: { token: mocks.token } }));

function jwt(lifetimeSeconds: number, label = "a") {
  const encode = (value: object) =>
    btoa(JSON.stringify(value)).replace(/=+$/, "");
  // A browser clock far behind the server must not matter: only exp - iat is used.
  const iat = 4_000_000_000;
  return `${encode({ alg: "RS256" })}.${encode({ iat, exp: iat + lifetimeSeconds, label })}.sig`;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
});

it("reuses one token until a minute before it expires", async () => {
  mocks.token
    .mockResolvedValueOnce({ data: { token: jwt(15 * 60, "first") } })
    .mockResolvedValueOnce({ data: { token: jwt(15 * 60, "second") } });
  const { backendToken } = await import("./backend-token");

  const first = await backendToken();
  vi.advanceTimersByTime(13 * 60_000);
  expect(await backendToken()).toBe(first);
  expect(mocks.token).toHaveBeenCalledTimes(1);

  vi.advanceTimersByTime(60_001);
  expect(await backendToken()).not.toBe(first);
  expect(mocks.token).toHaveBeenCalledTimes(2);
});

it("shares one request between concurrent callers", async () => {
  mocks.token.mockResolvedValue({ data: { token: jwt(900) } });
  const { backendToken } = await import("./backend-token");
  const tokens = await Promise.all([
    backendToken(),
    backendToken(),
    backendToken(),
  ]);
  expect(new Set(tokens).size).toBe(1);
  expect(mocks.token).toHaveBeenCalledTimes(1);
});

it("fetches again after the backend rejected the token", async () => {
  mocks.token.mockResolvedValue({ data: { token: jwt(900) } });
  const { backendToken, forgetBackendToken } = await import("./backend-token");
  await backendToken();
  forgetBackendToken();
  await backendToken();
  expect(mocks.token).toHaveBeenCalledTimes(2);
});

it("does not keep a failed or unreadable token", async () => {
  mocks.token
    .mockResolvedValueOnce({ data: null })
    .mockResolvedValueOnce({ data: { token: "not-a-jwt" } })
    .mockResolvedValueOnce({ data: { token: "not-a-jwt" } });
  const { backendToken } = await import("./backend-token");
  expect(await backendToken()).toBeNull();
  expect(await backendToken()).toBe("not-a-jwt");
  expect(await backendToken()).toBe("not-a-jwt");
  expect(mocks.token).toHaveBeenCalledTimes(3);
});

it("never shares a token between server requests", async () => {
  vi.stubGlobal("window", undefined);
  mocks.token.mockResolvedValue({ data: { token: jwt(900) } });
  const { backendToken } = await import("./backend-token");
  await backendToken();
  await backendToken();
  expect(mocks.token).toHaveBeenCalledTimes(2);
});
