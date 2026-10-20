"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ClipboardPasteIcon,
  FilesIcon,
  LibraryIcon,
  MonitorUpIcon,
  PlusIcon,
  UploadIcon,
} from "lucide-react";
import { useRef } from "react";
import { canCaptureScreen } from "../lib/capture";

export type AttachAction =
  | "upload"
  | "library"
  | "paste"
  | "screenshot"
  | "context";

const opensDialog = (action: AttachAction) =>
  action === "library" || action === "context";

export function AttachMenu({
  disabled,
  onAction,
}: {
  disabled?: boolean;
  onAction: (action: AttachAction) => void;
}) {
  const keepFocus = useRef(false);
  const select = (action: AttachAction) => {
    keepFocus.current = opensDialog(action);
    onAction(action);
  };
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-label="Add attachments"
          className="rounded-full"
        >
          <PlusIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-56"
        onCloseAutoFocus={(event) => {
          // A dialog opened from the menu owns focus; do not pull it back.
          if (keepFocus.current) event.preventDefault();
          keepFocus.current = false;
        }}
      >
        <DropdownMenuItem disabled={disabled} onSelect={() => select("upload")}>
          <UploadIcon />
          Upload files
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={disabled}
          onSelect={() => select("library")}
        >
          <LibraryIcon />
          From library
        </DropdownMenuItem>
        <DropdownMenuItem disabled={disabled} onSelect={() => select("paste")}>
          <ClipboardPasteIcon />
          Paste from clipboard
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={disabled || !canCaptureScreen()}
          onSelect={() => select("screenshot")}
        >
          <MonitorUpIcon />
          Take screenshot
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => select("context")}>
          <FilesIcon />
          Files in context
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
