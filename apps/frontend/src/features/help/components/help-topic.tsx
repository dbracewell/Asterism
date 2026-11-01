"use client";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useHelpAudience } from "@/features/help/components/help-audience";
import {
  helpEntries,
  isVisibleTo,
  type HelpId,
} from "@/features/help/registry";
import { cn } from "@/lib/utils";
import { ArrowLeftIcon, CircleQuestionMarkIcon } from "lucide-react";
import React from "react";

/**
 * A focusable "what is this?" button that explains one help entry in a popover
 * (ADR-0032). Works with click, tap and keyboard. Renders nothing for an
 * admin-only entry when the viewer is not an admin.
 */
export function HelpTopic({
  id,
  className,
  side = "top",
  align = "center",
}: {
  id: HelpId;
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}) {
  const { isAdmin } = useHelpAudience();
  const [open, setOpen] = React.useState(false);
  // Related links push onto this stack; Back pops it.
  const [trail, setTrail] = React.useState<HelpId[]>([id]);
  const [expanded, setExpanded] = React.useState(false);
  const titleRef = React.useRef<HTMLDivElement>(null);
  const detailsId = React.useId();

  const entry = helpEntries[id];
  if (!isVisibleTo(entry, isAdmin)) return null;

  const currentId = trail[trail.length - 1];
  const current = helpEntries[currentId];
  const related = current.related.filter((relatedId) =>
    isVisibleTo(helpEntries[relatedId], isAdmin),
  );

  const show = (next: HelpId[]) => {
    setTrail(next);
    setExpanded(false);
    // Move focus to the new title so screen readers announce the change.
    requestAnimationFrame(() => titleRef.current?.focus());
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setTrail([id]);
          setExpanded(false);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Help: ${entry.title}`}
          className={cn("text-muted-foreground", className)}
        >
          <CircleQuestionMarkIcon aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        aria-label={`Help: ${current.title}`}
        className="w-80 max-w-[calc(100vw-1rem)] gap-3"
      >
        <PopoverHeader>
          <div className="flex items-center gap-1">
            {trail.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Back"
                onClick={() => show(trail.slice(0, -1))}
              >
                <ArrowLeftIcon aria-hidden="true" />
              </Button>
            )}
            <PopoverTitle
              ref={titleRef}
              tabIndex={-1}
              className="outline-none"
              role="heading"
              aria-level={2}
            >
              {current.title}
            </PopoverTitle>
          </div>
          <PopoverDescription className="text-popover-foreground text-sm">
            {current.summary}
          </PopoverDescription>
        </PopoverHeader>
        {current.details.length > 0 && (
          <div className="flex flex-col gap-2">
            {expanded && (
              <div
                id={detailsId}
                className="text-muted-foreground flex flex-col gap-2 text-sm"
              >
                {current.details.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            )}
            <Button
              type="button"
              variant="link"
              size="sm"
              className="self-start px-0"
              aria-expanded={expanded}
              aria-controls={expanded ? detailsId : undefined}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "Show less" : "Learn more"}
            </Button>
          </div>
        )}
        {related.length > 0 && (
          <nav aria-label="Related terms" className="flex flex-col gap-1">
            <p className="text-muted-foreground text-xs">Related</p>
            <ul className="flex flex-wrap gap-1">
              {related.map((relatedId) => (
                <li key={relatedId}>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => show([...trail, relatedId])}
                  >
                    {helpEntries[relatedId].title}
                  </Button>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </PopoverContent>
    </Popover>
  );
}
