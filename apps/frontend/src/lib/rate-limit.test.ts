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

  it("forgets the oldest key when full of live entries", () => {
    const limiter = createRateLimiter({
      max: 1,
      windowMs: 60_000,
      maxEntries: 2,
    });
    expect(limiter.attempt("a")).toBe(true);
    expect(limiter.attempt("b")).toBe(true);
    // A new key still gets in, and "a" (the oldest) starts over.
    expect(limiter.attempt("c")).toBe(true);
    expect(limiter.attempt("b")).toBe(false);
    expect(limiter.attempt("c")).toBe(false);
    expect(limiter.attempt("a")).toBe(true);
  });

  it("evicts expired entries to admit a new key when full", () => {
    vi.useFakeTimers();
    const limiter = createRateLimiter({
      max: 5,
      windowMs: 1_000,
      maxEntries: 1,
    });
    expect(limiter.attempt("a")).toBe(true);
    vi.advanceTimersByTime(1_001);
    expect(limiter.attempt("b")).toBe(true);
    expect(limiter.attempt("b")).toBe(true);
  });

  it("keys by the first forwarded address", () => {
    expect(clientIpKey("1.2.3.4, 5.6.7.8")).toBe("1.2.3.4");
    expect(clientIpKey(null)).toBe("unknown");
    expect(clientIpKey("x".repeat(65))).toBe("unknown");
  });

  it("keys IPv6 addresses by their /64 network", () => {
    expect(clientIpKey("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64");
    expect(clientIpKey("2001:0db8:0001:0002:ffff:1:2:3")).toBe(
      "2001:db8:1:2::/64",
    );
    expect(clientIpKey("2001:db8::5")).toBe("2001:db8:0:0::/64");
    expect(clientIpKey("[2001:db8:1:2::9]")).toBe("2001:db8:1:2::/64");
    expect(clientIpKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(clientIpKey("::ffff:10.0.0.7")).toBe("10.0.0.7");
    expect(clientIpKey("not:an:address")).toBe("not:an:address");
  });
});
