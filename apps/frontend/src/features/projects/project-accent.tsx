import type { Project } from "@/lib/client";
import { cn } from "@/lib/utils";

export type ProjectAccent = NonNullable<Project["accent"]>;

/**
 * Swatches use the theme-independent `--color-project-*` tokens, mid-tones that
 * read on both light and dark sidebars. They are decorative:
 * the project name always carries the meaning, so the dot is hidden from
 * assistive tech wherever a name sits beside it.
 */
export const PROJECT_ACCENTS: Record<
  ProjectAccent,
  { label: string; swatch: string }
> = {
  red: { label: "Red", swatch: "bg-project-red" },
  orange: { label: "Orange", swatch: "bg-project-orange" },
  amber: { label: "Amber", swatch: "bg-project-amber" },
  green: { label: "Green", swatch: "bg-project-green" },
  teal: { label: "Teal", swatch: "bg-project-teal" },
  sky: { label: "Sky", swatch: "bg-project-sky" },
  violet: { label: "Violet", swatch: "bg-project-violet" },
  pink: { label: "Pink", swatch: "bg-project-pink" },
};

export function ProjectAccentDot({
  accent,
  className,
}: {
  accent: Project["accent"];
  className?: string;
}) {
  if (!accent) return null;
  return (
    <span
      aria-hidden="true"
      data-accent={accent}
      className={cn(
        "rounded-dot size-2 shrink-0",
        PROJECT_ACCENTS[accent].swatch,
        className,
      )}
    />
  );
}
