import { createRateLimiter } from "@/lib/rate-limit";

// Browser POSTs to the SSE endpoint, per signed-in user. Per process, like the
// other rate limits.
export const streamLimiter = createRateLimiter({ max: 50, windowMs: 60_000 });
