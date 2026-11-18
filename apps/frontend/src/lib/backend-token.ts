import { authClient } from "@/lib/auth-client";

/** Refetch this long before the token expires. */
const REFRESH_MARGIN_MS = 60_000;

let cached: { token: string; refreshAt: number } | null = null;
let pending: Promise<string | null> | null = null;

/** The token's lifetime from its own claims; 0 when unreadable. */
function lifetimeMs(token: string): number {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const { iat, exp } = JSON.parse(atob(payload));
    return typeof iat === "number" && typeof exp === "number"
      ? (exp - iat) * 1000
      : 0;
  } catch {
    return 0;
  }
}

async function fetchToken(): Promise<string | null> {
  const { data } = await authClient.token();
  return data?.token ?? null;
}

/**
 * The backend JWT for this tab (US-86.7).
 *
 * Fetched once and reused until a minute before it expires, with concurrent
 * callers sharing one request; the lifetime is measured from when it arrived,
 * so a wrong browser clock cannot keep an expired token. Fetching one for every
 * backend call signed a JWT per request and spent a class's shared per-address
 * auth limit. On the server every call fetches: a module-level token there
 * would be shared between users.
 */
export async function backendToken(): Promise<string | null> {
  if (typeof window === "undefined") return fetchToken();
  if (cached && cached.refreshAt > Date.now()) return cached.token;
  pending ??= fetchToken()
    .then((token) => {
      const fetchedAt = Date.now();
      cached = token
        ? {
            token,
            refreshAt: fetchedAt + lifetimeMs(token) - REFRESH_MARGIN_MS,
          }
        : null;
      return token;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** Drop the reused token, after the backend rejected it. */
export function forgetBackendToken() {
  cached = null;
}
