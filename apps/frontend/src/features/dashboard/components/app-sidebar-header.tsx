"use client";

import { Button } from "@/components/ui/button";
import { SidebarHeader, useSidebar } from "@/components/ui/sidebar";
import { FullLogo } from "@/features/dashboard/components/full-logo";
import { PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react";

export const AppSidebarHeader = () => {
  const { state, toggleSidebar } = useSidebar();
  return (
    <SidebarHeader
      style={{ height: "var(--header-height)" }}
      className="overflow-clip"
    >
      {state === "expanded" && <FullLogo />}
      <Button
        variant="ghost"
        title="Toggle sidebar"
        size="icon-lg"
        className="text-muted-foreground size-7! [&_>svg]:size-5!"
        onClick={() => toggleSidebar()}
      >
        {state === "expanded" ? <PanelLeftCloseIcon /> : <PanelLeftOpenIcon />}
      </Button>
    </SidebarHeader>
  );
};
