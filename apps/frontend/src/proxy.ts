import { auth } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

export function getSetupRedirectPath(
  pathname: string,
  requiresSetup: boolean,
): string | null {
  const isSetupPath = pathname.startsWith("/app/setup");

  if (requiresSetup && !isSetupPath) {
    return "/app/setup";
  }

  if (!requiresSetup && isSetupPath) {
    return "/app";
  }

  return null;
}

export async function proxy(request: NextRequest) {
  const requestHeaders = request.headers;

  let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null;
  let jwtToken: Awaited<ReturnType<typeof auth.api.getToken>> | null = null;

  try {
    [session, jwtToken] = await Promise.all([
      auth.api.getSession({ headers: requestHeaders }),
      auth.api.getToken({ headers: requestHeaders }),
    ]);
  } catch {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (!session || !jwtToken) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_API_URL;
  if (!backendUrl) {
    return NextResponse.next();
  }

  try {
    const setupStatusResponse = await fetch(`${backendUrl}/api/setup/status`, {
      headers: {
        Authorization: `Bearer ${jwtToken.token}`,
      },
      cache: "no-store",
    });

    if (!setupStatusResponse.ok) {
      return NextResponse.next();
    }

    const setupStatus = (await setupStatusResponse.json()) as {
      requires_setup: boolean;
    };

    const redirectPath = getSetupRedirectPath(
      request.nextUrl.pathname,
      setupStatus.requires_setup,
    );

    if (redirectPath) {
      return NextResponse.redirect(new URL(redirectPath, request.url));
    }
  } catch {
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*"],
};
