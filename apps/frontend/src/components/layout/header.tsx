"use client";

import Constellation from "@/components/logo";
import { Button } from "@/components/ui/button";
import { useAppContext } from "@/app/app/app-provider";
import { authClient } from "@/lib/auth-client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export const Header = () => {
  const { user } = useAppContext();
  const router = useRouter();
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
    <div className="bg-sidebar sticky flex h-10 items-center justify-between overflow-clip border-b px-3 py-1 shadow-sm select-none">
      <Link href="/app" className="group flex items-center font-monsterrat">
        <Constellation className="opacity-50" />
        <h1 className="text-lg font-semibold">ASTERISM</h1>
      </Link>

      <div className="flex items-center gap-2">
        <Link href="/app/setup" className="text-xs underline">
          Setup
        </Link>
        <span className="text-muted-foreground text-xs">{user.email}</span>
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
