/**
 * Validates and normalizes redirect URLs to prevent open-redirect vulnerabilities.
 * Ensures the redirect target is a safe relative pathname on the current origin.
 */
export function sanitizeRedirectPath(referer?: string): string {
  if (!referer) return "/";
  const trimmed = referer.trim();
  if (
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.includes("\\") ||
    trimmed.startsWith("/sign-in")
  ) {
    return "/";
  }
  try {
    const parsed = new URL(trimmed, "http://localhost");
    if (
      parsed.origin !== "http://localhost" ||
      parsed.pathname === "/sign-in" ||
      parsed.pathname.startsWith("/sign-in/")
    ) {
      return "/";
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}
