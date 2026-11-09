"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CircleQuestionMarkIcon,
  ClipboardCheckIcon,
  ClipboardPasteIcon,
  ColumnsIcon,
  FilesIcon,
  LayoutTemplateIcon,
  LibraryIcon,
  MonitorUpIcon,
  PlusIcon,
  SlashIcon,
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

export type ComposerAction =
  | AttachAction
  | "templates"
  | "review"
  | "skills"
  | "compare"
  | "help";

/** Actions that move focus to a dialog, popover or the message box. */
const movesFocus = (action: ComposerAction) =>
  action !== "upload" &&
  action !== "paste" &&
  action !== "screenshot" &&
  action !== "review";

/** An item the composer offers; omitted items are not shown. */
type Offer = { disabled?: boolean; description?: string };

/**
 * The composer's "+" menu (US-73.2): attachments, writing aids, comparison
 * and help. The everyday controls stay in the chip row and the action row.
 */
export function ComposerMenu({
  ref,
  disabled,
  templates,
  review,
  skills,
  compare,
  onAction,
}: {
  ref?: React.Ref<HTMLButtonElement>;
  /** Disables attaching while the composer is busy. */
  disabled?: boolean;
  templates?: Offer;
  review?: Offer;
  skills?: Offer;
  compare?: Offer;
  onAction: (action: ComposerAction) => void;
}) {
  const keepFocus = useRef(false);
  const select = (action: ComposerAction) => {
    keepFocus.current = movesFocus(action);
    onAction(action);
  };
  const writing = templates || review || skills;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          ref={ref}
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-label="More options"
          data-tour="options"
          className="rounded-control"
        >
          <PlusIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-60"
        onCloseAutoFocus={(event) => {
          // A dialog, popover or the message box owns focus; don't pull it back.
          if (keepFocus.current) event.preventDefault();
          keepFocus.current = false;
        }}
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>Attach</DropdownMenuLabel>
          <DropdownMenuItem
            disabled={disabled}
            onSelect={() => select("upload")}
          >
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
          <DropdownMenuItem
            disabled={disabled}
            onSelect={() => select("paste")}
          >
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
          <DropdownMenuItem onSelect={() => select("context")}>
            <FilesIcon />
            Files in context
          </DropdownMenuItem>
        </DropdownMenuGroup>
        {writing && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Write</DropdownMenuLabel>
              {templates && (
                <MenuOffer
                  offer={templates}
                  onSelect={() => select("templates")}
                >
                  <LayoutTemplateIcon />
                  Prompt templates
                </MenuOffer>
              )}
              {review && (
                <MenuOffer offer={review} onSelect={() => select("review")}>
                  <ClipboardCheckIcon />
                  Review prompt
                </MenuOffer>
              )}
              {skills && (
                <MenuOffer offer={skills} onSelect={() => select("skills")}>
                  <SlashIcon />
                  Skills
                </MenuOffer>
              )}
            </DropdownMenuGroup>
          </>
        )}
        {compare && (
          <>
            <DropdownMenuSeparator />
            <MenuOffer offer={compare} onSelect={() => select("compare")}>
              <ColumnsIcon />
              Compare models
            </MenuOffer>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => select("help")}>
          <CircleQuestionMarkIcon />
          Help: chat controls
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MenuOffer({
  offer,
  onSelect,
  children,
}: {
  offer: Offer;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenuItem
      disabled={offer.disabled}
      onSelect={onSelect}
      className="flex-wrap"
    >
      {children}
      {offer.description && (
        <span className="text-muted-foreground basis-full pl-6 text-xs">
          {offer.description}
        </span>
      )}
    </DropdownMenuItem>
  );
}
