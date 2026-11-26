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
        // Re-insert so the map stays ordered by window start, oldest first.
        store.delete(key);
        if (store.size >= maxEntries) {
          for (const [stale, value] of store) {
            if (now > value.resetAt) store.delete(stale);
          }
          // Full of live entries: forget the oldest rather than refuse
          // everyone, so filling the store can't lock real people out.
          if (store.size >= maxEntries) {
            const oldest = store.keys().next().value;
            if (oldest !== undefined) store.delete(oldest);
          }
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
  if (!candidate || candidate.length > 64) return "unknown";
  return candidate.includes(":") ? ipv6Network(candidate) : candidate;
}

/**
 * The /64 network of an IPv6 address, which one host can fill with addresses
 * of its own, so it counts as one client. IPv4-mapped addresses key as IPv4.
 */
function ipv6Network(address: string): string {
  const plain = address
    .replace(/^\[|\]$/g, "")
    .split("%", 1)[0]
    .toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(plain);
  if (mapped) return mapped[1];
  const halves = plain.split("::");
  if (halves.length > 2) return plain;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const gap = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (gap < 0) return plain;
  const groups = [...head, ...Array<string>(gap).fill("0"), ...tail];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g)))
    return plain;
  return `${groups
    .slice(0, 4)
    .map((g) => parseInt(g, 16).toString(16))
    .join(":")}::/64`;
}
