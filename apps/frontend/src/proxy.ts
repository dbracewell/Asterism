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

  const url = new URL(request.url);
  const page = url.pathname.split("/").pop() ?? "/";

  if (!session && !publicRoutes.includes(page)) {
    //Not logged in and trying to navigate to
    // somewhere that isn't the login page
    response = NextResponse.redirect(
      new URL(
        `/sign-in?redirect=${encodeURIComponent(request.url)}`,
        request.url,
      ),
    );
  } else if (session && publicRoutes.includes(page)) {
    //Is logged and have reached an auth authRoute
    // redirect to app
    response = NextResponse.redirect(new URL("/", request.url));
  }

  if (request.cookies.get(THEME_REFRESH_COOKIE)?.value != null) {
    response.cookies.delete(THEME_REFRESH_COOKIE);
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!api/auth|api/stream|_next|monitoring|sign-in|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
  ],
};
