import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuAction } from "@/components/ui/sidebar";
import { useChatSessionCrud } from "@/hooks/use-chat-session-crud";
import { cn } from "@/lib/utils";
import { EllipsisIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

export const ChatSessionActionMenu = ({
  session_id,
  button = false,
}: {
  session_id: string;
  button?: boolean;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const { deleteChatSession, isDeleting } = useChatSessionCrud();

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        {button ? (
          <button
            className={cn(
              "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground opacity-0 group-hover/item:opacity-100",
              isOpen && "opacity-100",
            )}
          >
            <EllipsisIcon className="size-4" />
          </button>
        ) : (
          <SidebarMenuAction
            className={cn(
              "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground opacity-0 group-hover/item:opacity-100",
              isOpen && "opacity-100",
            )}
          >
            <EllipsisIcon />
          </SidebarMenuAction>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem
          disabled={isDeleting}
          onClick={() =>
            deleteChatSession({
              path: {
                session_id,
              },
            })
          }
        >
          <Trash2Icon /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
