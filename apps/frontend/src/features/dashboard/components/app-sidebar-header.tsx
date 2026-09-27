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
  return (
    <SidebarHeader
      style={{ height: "var(--header-height)" }}
      className="overflow-clip"
    >
      {(state === "expanded" || isMobile) && <FullLogo />}
      <Hint
        asChild
        hidden={state === "expanded"}
        hint={"Expand sidebar"}
        align="end"
        side="right"
      >
        <Button
          variant="ghost"
          size="icon-lg"
          className={cn(
            "text-muted-foreground size-6! [&_>svg]:size-5!",
            state !== "expanded" && "size-8! [&_>svg]:size-7!",
          )}
          onClick={() => toggleSidebar()}
        >
          {state === "expanded" ? (
            <PanelLeftCloseIcon />
          ) : (
            <Constellation size={64} />
          )}
        </Button>
      </Hint>
    </SidebarHeader>
  );
};
