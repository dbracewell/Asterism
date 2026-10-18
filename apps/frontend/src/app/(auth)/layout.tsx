import type { Viewport } from "next";
import type { ReactNode } from "react";

// On supporting mobile browsers, let a virtual keyboard reduce the layout
// viewport. Zoom remains enabled; this policy belongs only to auth routes.
export const viewport: Viewport = { interactiveWidget: "resizes-content" };

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main
      aria-label="Authentication"
      className="flex h-dvh min-h-0 w-full flex-none scroll-py-6 flex-col items-center overflow-y-auto px-4 py-6"
    >
      {children}
    </main>
  );
}
