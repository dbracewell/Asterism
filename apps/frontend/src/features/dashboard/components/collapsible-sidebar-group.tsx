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
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ListChecksIcon,
  PlusIcon,
} from "lucide-react";
import { WorkspaceNavigationRow } from "./workspace-navigation-row";
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

  const actions = (
    <div className="flex shrink-0 gap-1 opacity-0 group-focus-within/label:opacity-100 group-hover/label:opacity-100">
      <>
        {secondaryMenuActionLabel && (
          <Button
            variant="sidebarGhost"
            size="icon-sm"
            aria-label={secondaryMenuActionLabel}
            onClick={onSecondaryMenuActionClick}
          >
            <ListChecksIcon />
          </Button>
        )}
        <Button
          variant="sidebarGhost"
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
  );

  return (
    <SidebarGroup
      role="region"
      aria-label={label}
      className={cn("flex overflow-hidden", className)}
    >
      <SidebarGroupContent className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden">
        <Collapsible
          open={isOpen}
          onOpenChange={handleOpenChange}
          className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
          {href ? (
            <WorkspaceNavigationRow
              label={label}
              href={href}
              open={isOpen}
              active={isActive}
              onToggle={() => handleOpenChange(!isOpen)}
              actions={actions}
            />
          ) : (
            <div className="group/label hover:bg-sidebar-accent rounded-control flex w-full shrink-0 items-center group-data-[collapsible=icon]:hidden">
              <CollapsibleTrigger asChild>
                <Button
                  variant="sidebarGhost"
                  size="icon-sm"
                  aria-label={`Toggle ${label}`}
                >
                  {isOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
                </Button>
              </CollapsibleTrigger>
              <SidebarGroupLabel
                className="min-w-0 flex-1 shrink px-0"
                title={label}
              >
                <span className="truncate">{label}</span>
              </SidebarGroupLabel>
              {actions}
            </div>
          )}
          <CollapsibleContent className="mt-1 flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto group-data-[collapsible=icon]:hidden">
            {children}
          </CollapsibleContent>
        </Collapsible>
      </SidebarGroupContent>
    </SidebarGroup>
  );
};
