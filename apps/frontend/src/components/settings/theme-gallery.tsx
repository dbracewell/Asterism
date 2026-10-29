"use client";

import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTheme } from "@/features/theme/components/theme-context";
import { themeToCssVariables } from "@/features/theme/lib/utils";
import type { Theme } from "@/features/theme/types";
import { cn } from "@/lib/utils";
import { PencilIcon } from "lucide-react";
import Link from "next/link";
import { type CSSProperties, useId } from "react";

type ThemeSummary = { name: string; filename: string };

interface ThemeGalleryProps {
  /** Id of the visible label; falls back to a "Theme" aria-label. */
  labelId?: string;
  currentTheme?: string;
  onChange?: (theme: string) => void;
  /** Shows an editor link on the selected tile; only admins may edit themes. */
  canEdit?: boolean;
}

/** Link to the admin theme editor with `theme` preselected. */
export const themeEditorHref = (filename: string) =>
  `/settings?${new URLSearchParams({ t: "admin", setting: "theme_editor", theme: filename })}`;

/**
 * Themes as live preview tiles. Each tile is a radio, so arrow keys move
 * between themes and the selection is announced as checked.
 */
export const ThemeGallery = ({
  labelId,
  currentTheme,
  onChange,
  canEdit = false,
}: ThemeGalleryProps) => {
  const { lightThemes, darkThemes } = useTheme();
  const groups = [
    { title: "Light", themes: lightThemes },
    { title: "Dark", themes: darkThemes },
  ].filter((group) => group.themes.length > 0);

  return (
    <RadioGroup
      aria-labelledby={labelId}
      aria-label={labelId ? undefined : "Theme"}
      value={currentTheme ?? ""}
      onValueChange={(name) => onChange?.(name)}
      className="flex min-w-0 flex-col gap-4"
    >
      {groups.map((group) => (
        <div
          key={group.title}
          role="group"
          aria-label={`${group.title} themes`}
          className="flex min-w-0 flex-col gap-2"
        >
          <h3 className="text-muted-foreground text-xs font-medium">
            {group.title}
          </h3>
          <div className="grid min-w-0 grid-cols-[repeat(auto-fill,minmax(min(9.5rem,100%),1fr))] gap-3">
            {group.themes.map((theme) => (
              <ThemeTile
                key={theme.filename}
                theme={theme}
                selected={theme.filename === currentTheme}
                canEdit={canEdit}
              />
            ))}
          </div>
        </div>
      ))}
    </RadioGroup>
  );
};

const ThemeTile = ({
  theme,
  selected,
  canEdit,
}: {
  theme: ThemeSummary;
  selected: boolean;
  canEdit: boolean;
}) => {
  const id = useId();
  const { getTheme } = useTheme();
  const palette = getTheme(theme.filename);
  return (
    <div data-theme-tile={theme.filename} className="relative min-w-0">
      <FieldLabel
        htmlFor={id}
        className="rounded-surface has-data-checked:border-primary has-data-checked:ring-primary hover:bg-muted/50 w-full cursor-pointer flex-col items-stretch border p-2 has-data-checked:ring-1"
      >
        {palette && <ThemePreviewTile theme={palette} />}
        <span className="flex min-h-6 min-w-0 items-center gap-2 pr-7 leading-snug">
          <RadioGroupItem id={id} value={theme.filename} />
          <span className="min-w-0 text-xs font-medium wrap-break-word">
            {theme.name}
          </span>
        </span>
      </FieldLabel>
      {selected && canEdit && (
        // A sibling of the label: interactive content must not nest inside it.
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              asChild
              size="icon-xs"
              variant="ghost"
              className="absolute right-2 bottom-2"
            >
              <Link
                href={themeEditorHref(theme.filename)}
                aria-label={`Edit ${theme.name} theme`}
              >
                <PencilIcon />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Edit in theme editor</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
};

// Custom properties inherit, so the mock re-scopes this theme's variables.
const ThemePreviewTile = ({ theme }: { theme: Theme }) => (
  <div
    aria-hidden
    data-testid="theme-preview-tile"
    style={themeToCssVariables(theme) as CSSProperties}
    className={cn(
      "bg-background rounded-control flex h-20 min-w-0 overflow-hidden border",
      theme.type === "dark" && "dark",
    )}
  >
    <div className="bg-sidebar border-sidebar-border flex w-1/4 flex-col gap-1 border-r p-1.5">
      <span className="bg-sidebar-primary rounded-chip h-1.5 w-full" />
      <span className="bg-sidebar-accent rounded-chip h-1.5 w-3/4" />
      <span className="bg-sidebar-foreground/30 rounded-chip h-1.5 w-2/3" />
    </div>
    <div className="flex min-w-0 flex-1 flex-col justify-between gap-1 p-1.5">
      <div className="bg-card border-border rounded-control flex flex-col gap-1 border p-1">
        <span className="bg-foreground/70 rounded-chip h-1 w-3/4" />
        <span className="bg-muted-foreground/60 rounded-chip h-1 w-1/2" />
      </div>
      <div className="flex items-center justify-end gap-1">
        <span className="bg-secondary rounded-control h-2.5 w-5" />
        <span className="bg-primary rounded-control h-2.5 w-7" />
      </div>
    </div>
  </div>
);
