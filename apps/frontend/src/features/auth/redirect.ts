import z from "zod";

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

const signInSearchSchema = z.object({
  redirect: z.union([z.string(), z.array(z.string())]).optional(),
});

/**
 * The safe return path from sign-in search params. A repeated `redirect`
 * uses the first value; anything malformed falls back to the home page.
 */
export function signInRedirectPath(searchParams: unknown): string {
  const parsed = signInSearchSchema.safeParse(searchParams);
  const value = parsed.success ? parsed.data.redirect : undefined;
  return sanitizeRedirectPath(Array.isArray(value) ? value[0] : value);
}
