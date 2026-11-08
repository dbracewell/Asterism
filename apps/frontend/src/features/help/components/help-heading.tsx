import { HelpTopic } from "@/features/help/components/help-topic";
import type { HelpId } from "@/features/help/registry";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * A section heading with its "what is this?" button beside it (US-66.2). The
 * button sits outside the heading so the heading's accessible name stays the
 * section's name.
 */
export function HelpHeading({
  as: Heading = "h2",
  help,
  className,
  wrapperClassName,
  children,
}: {
  as?: "h2" | "h3";
  help: HelpId;
  className?: string;
  wrapperClassName?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex items-center gap-1", wrapperClassName)}>
      <Heading className={className}>{children}</Heading>
      <HelpTopic id={help} />
    </div>
  );
}
