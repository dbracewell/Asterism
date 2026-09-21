import {
  MAX_RATE_LIMIT_ENTRIES,
  checkRateLimit,
  clearRateLimitStore,
  clientIpKey,
  rateLimitEntryCount,
} from "@/features/sse/lib/rate-limiter";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  clearRateLimitStore();
  vi.useRealTimers();
});

describe("SSE rate limiter", () => {
  it("normalizes forwarded addresses and rejects oversized keys", () => {
    expect(clientIpKey("203.0.113.4, proxy")).toBe("203.0.113.4");
    expect(clientIpKey("x".repeat(65))).toBe("unknown");
  });

  it("expires entries lazily without a process-global interval", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    expect(checkRateLimit("203.0.113.4")).toBe(true);
    expect(rateLimitEntryCount()).toBe(1);

    vi.setSystemTime(60_001);
    expect(rateLimitEntryCount()).toBe(0);
  });

  it("caps high-cardinality keys", () => {
    for (let index = 0; index < MAX_RATE_LIMIT_ENTRIES; index++) {
      expect(checkRateLimit(`203.0.${Math.floor(index / 256)}.${index % 256}`)).toBe(true);
    }
    expect(checkRateLimit("198.51.100.1")).toBe(false);
    expect(rateLimitEntryCount()).toBe(MAX_RATE_LIMIT_ENTRIES);
  });
});
