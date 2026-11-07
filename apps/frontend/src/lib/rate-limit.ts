/** Bounded, per-process fixed-window rate limiting keyed by a string. */

export type RateLimiter = {
  /** Records an attempt; false once the key is over its limit for the window. */
  attempt(key: string): boolean;
  clear(): void;
};

export function createRateLimiter({
  max,
  windowMs,
  maxEntries = 10_000,
}: {
  max: number;
  windowMs: number;
  maxEntries?: number;
}): RateLimiter {
  const store = new Map<string, { count: number; resetAt: number }>();
  return {
    attempt(key) {
      const now = Date.now();
      const entry = store.get(key);
      if (!entry || now > entry.resetAt) {
        if (!entry && store.size >= maxEntries) {
          for (const [stale, value] of store) {
            if (now > value.resetAt) store.delete(stale);
          }
          if (store.size >= maxEntries) return false;
        }
        store.set(key, { count: 1, resetAt: now + windowMs });
        return true;
      }
      entry.count++;
      return entry.count <= max;
    },
    clear() {
      store.clear();
    },
  };
}

export function clientIpKey(forwardedFor: string | null): string {
  const candidate = forwardedFor?.split(",", 1)[0]?.trim();
  // Avoid retaining arbitrary-sized/high-cardinality header values as keys.
  return candidate && candidate.length <= 64 ? candidate : "unknown";
}
