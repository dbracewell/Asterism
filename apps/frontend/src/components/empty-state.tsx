import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import type { ComponentProps, ReactNode } from "react";

/**
 * The one shape for empty and blocked screens: a sentence-case title without
 * a full stop, one sentence of guidance that names the next step, and a
 * primary action when one applies.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
  ...props
}: Omit<ComponentProps<typeof Empty>, "title" | "children"> & {
  title: ReactNode;
  description: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <Empty data-empty-state="" {...props}>
      <EmptyHeader>
        {icon && <EmptyMedia variant="icon">{icon}</EmptyMedia>}
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action}
    </Empty>
  );
}
