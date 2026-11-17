import "server-only";

import { createRateLimiter } from "@/lib/rate-limit";

// Account creation from one address, shared by first-run install and invite
// sign-up. Slows admin-key guessing, account spam and invite probing. Per
// process, like the other rate limits.
export const signupLimiter = createRateLimiter({
  max: 10,
  windowMs: 15 * 60_000,
});
