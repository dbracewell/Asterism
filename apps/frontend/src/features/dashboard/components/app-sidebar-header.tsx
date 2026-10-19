"use client";

import { FullLogo } from "@/components/full-logo";
import Constellation from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { SidebarHeader, useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { PanelLeftCloseIcon } from "lucide-react";

export const AppSidebarHeader = () => {
  const { state, toggleSidebar, isMobile } = useSidebar();
  const expanded = state === "expanded" || isMobile;
  const toggle = (
    <Button
      aria-label={
        isMobile
          ? "Close sidebar"
          : expanded
            ? "Collapse sidebar"
            : "Expand sidebar"
      }
      variant="ghost"
      size="icon-lg"
      className={cn(
        "text-muted-foreground size-6! [&_>svg]:size-5!",
        !expanded && "size-8! [&_>svg]:size-7!",
        isMobile && "size-11!",
      )}
      onClick={toggleSidebar}
    >
      {expanded ? <PanelLeftCloseIcon /> : <Constellation size={64} />}
    </Button>
  );
  return (
    <SidebarHeader
      style={{ height: "var(--header-height)" }}
      className="shrink-0 gap-2 overflow-clip"
    >
      {expanded && <FullLogo />}
      {isMobile ? (
        toggle
      ) : (
        <Hint
          asChild
          hidden={expanded}
          hint="Expand sidebar"
          align="end"
          side="right"
        >
          {toggle}
        </Hint>
      )}
    </SidebarHeader>
  );
};
