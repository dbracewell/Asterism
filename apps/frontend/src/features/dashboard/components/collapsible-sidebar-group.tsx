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
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import Cookie from "js-cookie";
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from "lucide-react";
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
}: {
  label: string;
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
          suppressHydrationWarning
          open={isOpen}
          onOpenChange={handleOpenChange}
          className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
          <div className="group/label hover:bg-sidebar-accent flex w-full items-center rounded-md">
            <CollapsibleTrigger className="flex-1">
              <SidebarGroupLabel className="flex-1 cursor-pointer select-none">
                {isOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}{" "}
                <span className="ml-2">{label}</span>
              </SidebarGroupLabel>
            </CollapsibleTrigger>
            <div className="flex opacity-0 group-hover/label:opacity-100">
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
          <CollapsibleContent className="mt-1 flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
            {children}
          </CollapsibleContent>
        </Collapsible>
      </SidebarGroupContent>
    </SidebarGroup>
  );
};
