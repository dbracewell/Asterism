import { THEME_REFRESH_COOKIE } from "@/features/theme/constants";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const publicRoutes = ["/sign-in", "/api/stream"];

export async function proxy(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  let response = NextResponse.next();

  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  const host = request.headers.get("x-forwarded-host") ?? request.nextUrl.host;
  const externalOrigin = `${proto}://${host}`;
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

  if (request.cookies.get(THEME_REFRESH_COOKIE)?.value != null) {
    response.cookies.delete(THEME_REFRESH_COOKIE);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!api/auth|api/stream|api/chat|_next|monitoring|sign-in|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
  ],
};
