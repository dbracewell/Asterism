import { getAuth } from "@/lib/auth";
import { pageContentSecurityPolicy } from "@/lib/content-security-policy";
import { getFrontendServerConfig } from "@/lib/server-config-core";
import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const publicRoutes = [
  "/sign-in",
  // Admin-issued password reset links are opened while signed out (US-86.2).
  "/reset-password",
  "/api/stream",
  // Readiness for the container health check (US-86.6).
  "/api/health",
  "/api/theme",
  "/api/theme/list",
];
if (process.env.ASTERISM_CONFIG_PROFILE === "test") {
  publicRoutes.push(
    "/e2e/sub-agent",
    "/e2e/agent-settings",
    "/e2e/skills",
    "/e2e/skill-chat",
    "/e2e/providers",
    "/e2e/provider-setup",
    "/e2e/planned-settings",
    "/e2e/files",
    "/e2e/file-manager",
    "/e2e/new-chat-agent",
    "/e2e/chat-search",
    "/e2e/chat-models",
    "/e2e/chat-model-session",
    "/e2e/projects",
    "/e2e/study",
    "/e2e/themes",
    "/e2e/theme-contrast",
    "/e2e/semantic-ui",
    "/e2e/responsiveness",
    "/e2e/chat-reachability",
    "/e2e/markdown",
    "/e2e/inline-files",
    "/e2e/verification",
    "/e2e/prose",
    "/e2e/help",
    "/e2e/help-center",
    "/e2e/canvas-preview",
  );
}

// Student invite links are opened before the student has an account.
function isPublicPath(pathname: string) {
  return publicRoutes.includes(pathname) || /^\/invite\/[^/]+$/.test(pathname);
}

export async function proxy(request: NextRequest) {
  const session = await getAuth().api.getSession({
    headers: await headers(),
  });

  const externalOrigin = getFrontendServerConfig().publicUrl;
  const pathname = request.nextUrl.pathname.trim();

  if (!session && !isPublicPath(pathname)) {
    // Not logged in and trying to navigate to somewhere that isn't public.
    // Keep the query string so the user lands back on the same view.
    const target = `${pathname}${request.nextUrl.search}`;
    const redirectUrl = new URL(
      `/sign-in?redirect=${encodeURIComponent(target)}`,
      externalOrigin,
    );
    return NextResponse.redirect(redirectUrl);
  }
  // The sign-in page itself redirects signed-in users.

  // US-86.5: a fresh nonce per page. Next.js reads it from the request's CSP
  // header and applies it to its own scripts while rendering.
  const policy = pageContentSecurityPolicy({
    nonce: Buffer.from(crypto.randomUUID()).toString("base64"),
    publicUrl: externalOrigin,
    development: process.env.NODE_ENV === "development",
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("X-Frame-Options", "DENY");
  return response;
}

// FastAPI validates its own Bearer tokens. Do not redirect API requests to HTML
// sign-in pages before the local development rewrite can proxy them.
export const config = {
  matcher: [
    "/((?!api/py(?:/|$)|api/auth|api/stream|api/chat|_next|monitoring|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
  ],
};
