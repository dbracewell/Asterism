"use client";

import { ThemeSelector } from "@/components/settings/theme-selector";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { FullLogo } from "@/features/dashboard/components/full-logo";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { useState } from "react";

export const Header = () => {
  const router = useRouter();
  const { state } = useSidebar();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const onSignOut = async () => {
    setIsSigningOut(true);
    try {
      await authClient.signOut();
      router.replace("/");
      router.refresh();
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <div
      className="bg-sidebar/5 absolute inset-x-0 top-0 z-10 flex items-center justify-between overflow-clip px-2 backdrop-blur-xs select-none"
      style={{ height: "var(--header-height)" }}
    >
      <div
        className={cn(
          "transition-opacity duration-200",
          state === "expanded" ? "opacity-0" : "opacity-100",
        )}
      >
        <FullLogo />
      </div>
      <div className="flex items-center gap-2">
        <ThemeSelector />
        <Button
          variant="outline"
          size="sm"
          onClick={onSignOut}
          disabled={isSigningOut}
        >
          Sign out
        </Button>
      </div>
    </div>
  );
};
