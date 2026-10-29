import { cn } from "@/lib/utils";
import { useId, type ReactNode } from "react";

type HeadingProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
};

/**
 * One settings pane: its `h1`, one sentence of description and optional
 * actions, followed by `SettingsSection` groups separated by dividers.
 */
export function SettingsPane({
  title,
  description,
  actions,
  className,
  children,
}: HeadingProps & { className?: string; children: ReactNode }) {
  return (
    <div
      data-settings-pane=""
      className={cn("flex min-w-0 flex-1 flex-col gap-6 p-2", className)}
    >
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
          <h1 className="text-lg font-semibold text-balance">{title}</h1>
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
      {children}
    </div>
  );
}

/**
 * A titled group of related settings. Consecutive sections are separated by a
 * divider; cards are reserved for distinct objects such as providers.
 */
export function SettingsSection({
  title,
  description,
  actions,
  className,
  children,
}: HeadingProps & { className?: string; children?: ReactNode }) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      data-settings-section=""
      className={cn(
        "flex min-w-0 flex-col gap-4 [&+&]:border-t [&+&]:pt-6",
        className,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
          <h2 id={headingId} className="text-base font-semibold">
            {title}
          </h2>
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
      </div>
      {children}
    </section>
  );
}

/**
 * The form's save actions, pinned to the bottom of the scrolling pane. While
 * `dirty`, the bar is raised and announces unsaved changes; otherwise it is a
 * quiet footer that can report `status`, such as a completed save.
 */
export function SettingsSaveBar({
  dirty,
  status,
  className,
  children,
}: {
  dirty: boolean;
  status?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-slot="settings-save-bar"
      data-dirty={dirty ? "" : undefined}
      className={cn(
        "bg-background sticky bottom-0 z-10 mt-auto flex min-w-0 flex-wrap items-center justify-end gap-x-4 gap-y-2 py-3",
        "data-dirty:border-t",
        className,
      )}
    >
      <p
        role="status"
        className="text-muted-foreground mr-auto min-w-0 text-sm text-pretty"
      >
        {dirty ? (
          <span className="text-foreground font-medium">Unsaved changes</span>
        ) : (
          status
        )}
      </p>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {children}
      </div>
    </div>
  );
}
