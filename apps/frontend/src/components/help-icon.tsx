"use client";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { CircleQuestionMarkIcon } from "lucide-react";

/**
 * Shows a short, dynamic description (for example a tool description from the
 * server) in a popover that opens on click, tap or keyboard. For product
 * concepts, use `HelpTopic` with a registry entry instead (ADR-0032).
 */
export const HelpIcon = ({
  text,
  label = "More information",
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) => {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          className={cn("text-muted-foreground", className)}
        >
          <CircleQuestionMarkIcon aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="max-w-[calc(100vw-1rem)] text-sm">
        {text}
      </PopoverContent>
    </Popover>
  );
};
