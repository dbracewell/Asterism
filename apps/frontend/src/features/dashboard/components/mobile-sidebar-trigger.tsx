"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";

export const MobileSidebarTrigger = () => (
  <header className="bg-accent text-accent-foreground sticky top-0 z-10 grid w-full shrink-0 grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center border-b md:hidden">
    <SidebarTrigger className="size-11!" />
    <span className="font-monsterrat min-w-0 py-1 text-center font-bold">
      Asterism
    </span>
  </header>
);
