import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * Announces `label` to assistive technology while sighted users see a
 * skeleton of the layout that is coming. The skeleton itself is hidden from
 * the accessibility tree.
 */
export function LoadingState({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      data-slot="loading-state"
      className={cn("w-full min-w-0", className)}
    >
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="flex w-full min-w-0 flex-col">
        {children}
      </div>
    </div>
  );
}

// Fixed, varied widths read as real content without layout shift between renders.
const WIDTHS = ["w-2/5", "w-1/2", "w-1/3", "w-3/5", "w-1/4"];

/** Rows of a divided list, such as projects or chats. */
export function ListSkeleton({
  label,
  rows = 4,
  detail = false,
  className,
}: {
  label: string;
  rows?: number;
  /** Adds a second, muted line per row, e.g. a description. */
  detail?: boolean;
  className?: string;
}) {
  return (
    <LoadingState label={label} className={className}>
      <div className="divide-y">
        {Array.from({ length: rows }, (_, index) => (
          <div
            key={index}
            className={cn("flex flex-col gap-2", detail ? "py-4" : "py-3")}
          >
            <Skeleton className={cn("h-4", WIDTHS[index % WIDTHS.length])} />
            {detail && <Skeleton className="h-3 w-4/5" />}
          </div>
        ))}
      </div>
    </LoadingState>
  );
}

/** Labelled fields of a settings pane or form. */
export function FormSkeleton({
  label,
  fields = 3,
  className,
}: {
  label: string;
  fields?: number;
  className?: string;
}) {
  return (
    <LoadingState label={label} className={className}>
      <div className="flex flex-col gap-5 py-2">
        {Array.from({ length: fields }, (_, index) => (
          <div key={index} className="flex flex-col gap-2">
            <Skeleton className={cn("h-3.5", WIDTHS[index % WIDTHS.length])} />
            <Skeleton className="rounded-control h-9 w-full max-w-md" />
          </div>
        ))}
      </div>
    </LoadingState>
  );
}

/** Alternating user and assistant turns of a chat transcript. */
export function TranscriptSkeleton({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <LoadingState
      label={label}
      className={cn("mx-auto max-w-4xl px-4 py-8", className)}
    >
      <div className="flex flex-col gap-8">
        {[0, 1].map((turn) => (
          <div key={turn} className="flex flex-col gap-8">
            <Skeleton className="rounded-surface ml-auto h-10 w-1/2 sm:w-1/3" />
            <div className="flex gap-3">
              <Skeleton className="rounded-dot size-7 shrink-0" />
              <div className="flex flex-1 flex-col gap-2 pt-1">
                <Skeleton className="h-3.5 w-11/12" />
                <Skeleton className="h-3.5 w-4/5" />
                <Skeleton className="h-3.5 w-3/5" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </LoadingState>
  );
}

/** Compact sidebar menu rows (fixed widths keep server and client equal). */
export function NavListSkeleton({
  label,
  rows = 3,
  className,
}: {
  label: string;
  rows?: number;
  className?: string;
}) {
  return (
    <LoadingState label={label} className={className}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex h-8 items-center px-2">
          <Skeleton className={cn("h-3.5", WIDTHS[index % WIDTHS.length])} />
        </div>
      ))}
    </LoadingState>
  );
}

/** A page title with its subtitle and trailing action. */
export function PageHeaderSkeleton({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <LoadingState label={label} className={className}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-7 w-1/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
        <Skeleton className="rounded-control h-9 w-32" />
      </div>
    </LoadingState>
  );
}
