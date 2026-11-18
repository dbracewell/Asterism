/**
 * Better Auth's own limiter, which counts per client address and path (US-86.7).
 *
 * Its default allows 3 sign-ins per 10 seconds, so a class of 30 behind one
 * school address took about 90 seconds to sign in, with refusals along the way.
 * Sign-in now matches nginx's auth limit of 60 writes per minute per address
 * (docker/nginx.conf). Other paths keep Better Auth's defaults.
 */
export const AUTH_RATE_LIMIT = {
  customRules: {
    "/sign-in/*": { window: 60, max: 60 },
  },
};
