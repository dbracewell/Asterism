import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import Cookie from "js-cookie";
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export const CollapsibleSidebarGroup = ({
  label,
  children,
  defaultIsOpen = false,
  cookieName,
  onMenuActionClick,
  onSecondaryMenuActionClick,
  secondaryMenuActionLabel,
  className,
  href,
  isActive,
}: {
  label: string;
  href?: string;
  isActive?: boolean;
  defaultIsOpen?: boolean;
  cookieName: string;
  children: React.ReactNode;
  onMenuActionClick: () => void;
  onSecondaryMenuActionClick?: () => void;
  secondaryMenuActionLabel?: string;
  className?: string;
}) => {
  const [isOpen, setIsOpen] = useState(defaultIsOpen);

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    Cookie.set(cookieName, `${open}`, { path: "/", expires: 365 });
  };

  return (
    <SidebarGroup className={cn("flex overflow-hidden", className)}>
      <SidebarGroupContent className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden">
        <Collapsible
          open={isOpen}
          onOpenChange={handleOpenChange}
          className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
          <div className="group/label hover:bg-sidebar-accent flex w-full items-center rounded-md group-data-[collapsible=icon]:hidden">
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Toggle ${label}`}
              >
                {isOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
              </Button>
            </CollapsibleTrigger>
            {href ? (
              <SidebarMenuButton asChild isActive={isActive}>
                <Link href={href}>{label}</Link>
              </SidebarMenuButton>
            ) : (
              <SidebarGroupLabel className="flex-1">{label}</SidebarGroupLabel>
            )}
            <div className="flex opacity-0 group-focus-within/label:opacity-100 group-hover/label:opacity-100">
              <>
                {secondaryMenuActionLabel && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={secondaryMenuActionLabel}
                    onClick={onSecondaryMenuActionClick}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                    >
                      <line
                        x1="4"
                        y1="12"
                        x2="24"
                        y2="12"
                        strokeWidth="4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Add to ${label}`}
                  onClick={() => {
                    handleOpenChange(true);
                    onMenuActionClick();
                  }}
                >
                  <PlusIcon />
                </Button>
              </>
            </div>
          </div>
          <CollapsibleContent className="mt-1 flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto group-data-[collapsible=icon]:hidden">
            {children}
          </CollapsibleContent>
        </Collapsible>
      </SidebarGroupContent>
    </SidebarGroup>
  );
};
