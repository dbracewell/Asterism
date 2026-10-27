"use client";

import { Button } from "@/components/ui/button";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export function WorkspaceNavigationRow({
  label,
  href,
  open,
  active,
  onToggle,
  actions,
}: {
  label: string;
  href: string;
  open: boolean;
  active?: boolean;
  onToggle: () => void;
  actions?: ReactNode;
}) {
  return (
    <div
      data-workspace-row={label}
      data-active={active === true}
      className={cn(
        "group/label hover:bg-sidebar-accent hover:text-sidebar-accent-foreground rounded-control flex h-8 w-full shrink-0 items-center group-data-[collapsible=icon]:hidden",
        active && "bg-sidebar-accent text-sidebar-accent-foreground",
      )}
    >
      <Button
        variant="sidebarGhost"
        size="icon-sm"
        className="shrink-0"
        aria-label={`Toggle ${label}`}
        aria-expanded={open}
        onClick={onToggle}
      >
        {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
      </Button>
      <SidebarMenuButton
        asChild
        className="min-w-0 flex-1 bg-transparent! pl-0 hover:bg-transparent!"
      >
        <Link href={href} aria-current={active ? "page" : undefined}>
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
      {actions}
    </div>
  );
}
