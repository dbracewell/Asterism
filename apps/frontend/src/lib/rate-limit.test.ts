import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIpKey, createRateLimiter } from "./rate-limit";

afterEach(() => vi.useRealTimers());

describe("createRateLimiter", () => {
  it("allows up to the limit per key, then resets after the window", () => {
    vi.useFakeTimers();
    const limiter = createRateLimiter({ max: 2, windowMs: 1_000 });
    expect([1, 2, 3].map(() => limiter.attempt("a"))).toEqual([
      true,
      true,
      false,
    ]);
    expect(limiter.attempt("b")).toBe(true);
    vi.advanceTimersByTime(1_001);
    expect(limiter.attempt("a")).toBe(true);
  });

  it("refuses new keys when full of live entries", () => {
    const limiter = createRateLimiter({
      max: 5,
      windowMs: 60_000,
      maxEntries: 1,
    });
    expect(limiter.attempt("a")).toBe(true);
    expect(limiter.attempt("b")).toBe(false);
  });

  it("keys by the first forwarded address", () => {
    expect(clientIpKey("1.2.3.4, 5.6.7.8")).toBe("1.2.3.4");
    expect(clientIpKey(null)).toBe("unknown");
    expect(clientIpKey("x".repeat(65))).toBe("unknown");
  });
});
