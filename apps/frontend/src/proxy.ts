import { getAuth } from "@/lib/auth";
import { getFrontendServerConfig } from "@/lib/server-config-core";
import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const publicRoutes = [
  "/sign-in",
  "/api/stream",
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
    "/e2e/planned-settings",
    "/e2e/files",
    "/e2e/file-manager",
    "/e2e/new-chat-agent",
    "/e2e/chat-search",
    "/e2e/chat-models",
    "/e2e/chat-model-session",
    "/e2e/projects",
    "/e2e/themes",
    "/e2e/theme-contrast",
    "/e2e/semantic-ui",
    "/e2e/responsiveness",
    "/e2e/chat-reachability",
    "/e2e/markdown",
  );
}

export async function proxy(request: NextRequest) {
  const session = await getAuth().api.getSession({
    headers: await headers(),
  });

  let response = NextResponse.next();

  const externalOrigin = getFrontendServerConfig().publicUrl;
  const pathname = request.nextUrl.pathname.trim();

  if (!session && !publicRoutes.includes(pathname)) {
    // Not logged in and trying to navigate to somewhere that isn't public
    const redirectUrl = new URL(
      `/sign-in?redirect=${encodeURIComponent(pathname)}`,
      externalOrigin,
    );
    response = NextResponse.redirect(redirectUrl);
  } else if (session && pathname === "/sign-in") {
    // Is logged in and trying to reach the sign-in page, redirect to app
    response = NextResponse.redirect(new URL("/", externalOrigin));
  }

  return response;
}

// FastAPI validates its own Bearer tokens. Do not redirect API requests to HTML
// sign-in pages before the local development rewrite can proxy them.
export const config = {
  matcher: [
    "/((?!api/py(?:/|$)|api/auth|api/stream|api/chat|_next|monitoring|sign-in|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
  ],
};
