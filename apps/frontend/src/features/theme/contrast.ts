/** Normal-sized opaque text roles. Alpha/hover/focus states require browser checks. */
export const themeTextPairs = [
  ["foreground", "background"],
  ["card-foreground", "card"],
  ["popover-foreground", "popover"],
  ["primary-foreground", "primary"],
  ["secondary-foreground", "secondary"],
  ["muted-foreground", "muted"],
  ["accent-foreground", "accent"],
  ["sidebar-foreground", "sidebar"],
  ["sidebar-primary-foreground", "sidebar-primary"],
  ["sidebar-accent-foreground", "sidebar-accent"],
] as const;

function luminance(hex: string): number {
  if (!/^#(?:[a-f\d]{3}|[a-f\d]{6})$/i.test(hex))
    throw new Error(`Expected an opaque hex color: ${hex}`);
  const value =
    hex.length === 4
      ? hex
          .slice(1)
          .split("")
          .map((c) => c + c)
          .join("")
      : hex.slice(1);
  return [0, 2, 4].reduce((sum, offset, index) => {
    const channel = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return (
      sum +
      (channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4) *
        [0.2126, 0.7152, 0.0722][index]
    );
  }, 0);
}

/** WCAG relative luminance in sRGB; callers compare the unrounded ratio. */
export function contrastRatio(first: string, second: string): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
