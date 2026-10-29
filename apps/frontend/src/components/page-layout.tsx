import { cn } from "@/lib/utils";
import type { ComponentProps, ReactNode } from "react";

/**
 * The shared frame for list pages (General, Projects, Search, Files): one
 * width, one gutter and one vertical rhythm below the app header. `fill`
 * lets a page such as the file manager stretch to the bottom of the view.
 */
export function PageLayout({
  className,
  fill = false,
  ...props
}: ComponentProps<"main"> & { fill?: boolean }) {
  return (
    <main
      data-page-layout=""
      className={cn(
        "mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-6 px-4 pt-6 pb-8 md:px-6 md:pt-8",
        fill ? "min-h-0 flex-1 pb-4" : "flex-1",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The page's single `h1` with one sentence of description and optional
 * actions. Actions wrap below the text on narrow screens.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      data-page-header=""
      className={cn(
        "flex min-w-0 flex-wrap items-start justify-between gap-x-6 gap-y-3",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
        <h1 className="text-title text-balance">{title}</h1>
        {description && (
          <p className="text-muted-foreground text-sm text-pretty">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </header>
  );
}
