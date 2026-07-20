"use client";

import { FullLogo } from "@/components/full-logo";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { useActiveChatSession } from "@/features/chat/hooks/use-active-chat-session";
import { cn } from "@/lib/utils";
import { PanelLeftOpenIcon } from "lucide-react";

export const Header = () => {
  const session = useActiveChatSession((state) => state.session);
  const { state, isMobile, toggleSidebar } = useSidebar();

  return (
    <div
      className="bg-sidebar/5 absolute inset-0 z-20 flex items-center justify-between overflow-clip p-2 backdrop-blur-xs select-none"
      style={{ height: "var(--header-height)" }}
    >
      {isMobile && (
        <Button
          variant="ghost"
          title="Toggle sidebar"
          size="icon-lg"
          className="text-muted-foreground size-7! [&_>svg]:size-5!"
          onClick={() => toggleSidebar()}
        >
          <PanelLeftOpenIcon />
        </Button>
      )}
      <div className="flex items-center gap-8">
        <div
          className={cn(
            "transition-discreteease-linear transition-all",
            state === "collapsed" || isMobile
              ? "block opacity-100 duration-200 starting:opacity-0"
              : "hidden opacity-0 duration-75",
          )}
        >
          <FullLogo fill="var(--color-foreground)" />
        </div>
        {session && (
          <h3 className="text-foreground transition-discrete duration-200 ease-linear">
            {session.info.title}
          </h3>
        )}
      </div>

      <div className="flex items-center gap-2"></div>
    </div>
  );
};
