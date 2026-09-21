/** Bounded in-memory rate limiter for the SSE POST endpoint. */

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

const RATE_LIMIT_MAX = 50;
const RATE_LIMIT_WINDOW_MS = 60_000;
export const MAX_RATE_LIMIT_ENTRIES = 10_000;

function evictExpired(now: number): void {
  for (const [key, entry] of rateLimitStore) {
    if (now > entry.resetAt) rateLimitStore.delete(key);
  }
}

export function clientIpKey(forwardedFor: string | null): string {
  const candidate = forwardedFor?.split(",", 1)[0]?.trim();
  // Avoid retaining arbitrary-sized/high-cardinality header values as keys.
  return candidate && candidate.length <= 64 ? candidate : "unknown";
}

export function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    if (!entry && rateLimitStore.size >= MAX_RATE_LIMIT_ENTRIES) {
      evictExpired(now);
      if (rateLimitStore.size >= MAX_RATE_LIMIT_ENTRIES) return false;
    }
    rateLimitStore.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

export function rateLimitEntryCount(): number {
  evictExpired(Date.now());
  return rateLimitStore.size;
}

export function clearRateLimitStore(): void {
  rateLimitStore.clear();
}
