import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenuAction,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import Cookie from "js-cookie";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";

export const CollapsibleSidebarGroup = ({
  label,
  children,
  defaultIsOpen = false,
  cookieName,
  onMenuActionClick,
  className,
}: {
  label: string;
  defaultIsOpen?: boolean;
  cookieName: string;
  children: React.ReactNode;
  onMenuActionClick: () => void;
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
          <div className="group/label flex w-full items-center">
            <CollapsibleTrigger className="w-full">
              <SidebarGroupLabel className="group-hover/label:bg-sidebar-accent w-full flex-1 cursor-pointer select-none">
                {isOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}{" "}
                <span className="ml-2">{label}</span>
              </SidebarGroupLabel>
            </CollapsibleTrigger>
            <SidebarMenuAction
              onClick={() => {
                handleOpenChange(true);
                onMenuActionClick();
              }}
              className="group-hover/label:bg-sidebar-accent mr-2 pt-1 opacity-0 group-hover/label:opacity-100"
            >
              +
            </SidebarMenuAction>
          </div>
          <CollapsibleContent className="mt-1 flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
            {children}
          </CollapsibleContent>
        </Collapsible>
      </SidebarGroupContent>
    </SidebarGroup>
  );
};
