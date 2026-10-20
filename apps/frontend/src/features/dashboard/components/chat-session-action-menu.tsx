import { Button } from "@/components/ui/button";
import { useConfirmationDialog } from "@/components/confirmation-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuAction } from "@/components/ui/sidebar";
import { useChatSessionCrud } from "@/features/chat/hooks/use-chat-session-crud";
import { cn } from "@/lib/utils";
import { EllipsisIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

export const ChatSessionActionMenu = ({
  chat_id,
  button = false,
}: {
  chat_id: string;
  button?: boolean;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const { deleteChatSession, isDeleting } = useChatSessionCrud();
  const { confirm, dialog } = useConfirmationDialog({
    title: "Delete chat?",
    description: "This permanently deletes this chat and its messages.",
    confirmVariant: "destructive",
  });

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        {button ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Chat actions"
            className={cn(
              "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground opacity-0 group-focus-within/item:opacity-100 group-hover/item:opacity-100 focus-visible:opacity-100",
              isOpen && "opacity-100",
            )}
          >
            <EllipsisIcon className="size-4" />
          </Button>
        ) : (
          <SidebarMenuAction
            aria-label="Chat actions"
            className={cn(
              "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground opacity-0 group-focus-within/item:opacity-100 group-hover/item:opacity-100 focus-visible:opacity-100",
              isOpen && "opacity-100",
            )}
          >
            <EllipsisIcon />
          </SidebarMenuAction>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={isDeleting}
            onClick={async () => {
              if (await confirm()) {
                deleteChatSession({
                  path: {
                    chat_id,
                  },
                });
              }
            }}
          >
            <Trash2Icon /> Delete
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
      {dialog}
    </DropdownMenu>
  );
};
