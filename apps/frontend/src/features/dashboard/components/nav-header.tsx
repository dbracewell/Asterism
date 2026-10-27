"use client";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useWorkspaceScope } from "@/features/projects/hooks/use-workspace-scope";
import { usePathname } from "next/navigation";
import { useMemo } from "react";

export const NavHeader = () => {
  const pathName = usePathname();
  const { projectId, chatTitle } = useWorkspaceScope();

  const title = useMemo(() => {
    if (chatTitle) return chatTitle;
    return pathName;
  }, [pathName, chatTitle]);

  return (
    <div className="bg-background flex h-12 items-center">
      <SidebarTrigger className="size-11!" />
      {title}
    </div>
  );
};
