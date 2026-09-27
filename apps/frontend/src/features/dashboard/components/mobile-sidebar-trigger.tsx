"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/use-mobile";

export const MobileSidebarTrigger = () => {
  const isMobile = useIsMobile();
  if (!isMobile) {
    return null;
  }
  return (
    <div className="bg-accent text-accent-foreground flex items-center border-b">
      <SidebarTrigger />
      <h4 className="font-monsterrat -ml-6 flex-1 py-0.5 text-center font-bold">
        Asterism
      </h4>
    </div>
  );
};
