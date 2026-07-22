/**
 * Simple in-memory rate limiter for the SSE POST endpoint.
 *
 * TODO: Replace with a distributed rate limiter (e.g. Upstash Redis)
 * when deploying to multiple instances.
 */

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

const RATE_LIMIT_MAX = 50;
const RATE_LIMIT_WINDOW_MS = 60_000;

export function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    return false;
  }
  return true;
}

// Periodically clean up expired entries to avoid memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetAt) {
      rateLimitStore.delete(key);
    }
  }
}, 300_000);
