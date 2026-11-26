import "server-only";

import { createRateLimiter } from "@/lib/rate-limit";

const WINDOW_MS = 15 * 60_000;

// First-run install from one address. Slows admin passphrase guessing. Per
// process, like the other rate limits.
export const installLimiter = createRateLimiter({
  max: 10,
  windowMs: WINDOW_MS,
});

// Invite sign-up from one address: room for a class of 30 behind one school
// network, with retries, while still slowing invite probing (US-112.1).
export const inviteAddressLimiter = createRateLimiter({
  max: 60,
  windowMs: WINDOW_MS,
});

// Attempts on one invite, so one link can't be retried without end.
export const inviteTokenLimiter = createRateLimiter({
  max: 5,
  windowMs: WINDOW_MS,
});

export function clearSignupLimits() {
  installLimiter.clear();
  inviteAddressLimiter.clear();
  inviteTokenLimiter.clear();
}
