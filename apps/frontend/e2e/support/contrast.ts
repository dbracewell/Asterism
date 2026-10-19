import type { Page } from "@playwright/test";

// Resolve modern browser color spaces through canvas, then composite ancestor
// backgrounds in sRGB. Keep the unrounded ratio for threshold decisions.
export async function measure(
  page: Page,
  id: string,
  kind: "text" | "placeholder" | "border" | "ring" | "fill" | "glyph" = "text",
) {
  return page
    .locator(
      id === "switch-thumb"
        ? '[data-contrast="switch"] [data-slot="switch-thumb"]'
        : `[data-contrast="${id}"]`,
    )
    .evaluate((element, kind) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      const rgba = (css: string) => {
        if (!CSS.supports("color", css))
          throw new Error(`Unsupported computed color: ${css}`);
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data].map((v) => v / 255);
      };
      const over = (front: number[], back: number[]) =>
        front
          .slice(0, 3)
          .map((v, i) => v * front[3] + back[i] * (1 - front[3]))
          .concat(1);
      function background(node: Element | null): number[] {
        return node
          ? over(
              rgba(getComputedStyle(node).backgroundColor),
              background(node.parentElement),
            )
          : [1, 1, 1, 1];
      }
      const style = getComputedStyle(element);
      const backdrop = background(element);
      const color =
        kind === "fill"
          ? style.backgroundColor
          : kind === "placeholder"
            ? getComputedStyle(element, "::placeholder").color
            : kind === "border"
              ? style.borderTopColor
              : kind === "ring"
                ? style.getPropertyValue("--tw-ring-color")
                : style.color;
      const bg =
        kind === "border" || kind === "ring" || kind === "fill"
          ? background(element.parentElement)
          : backdrop;
      const fg = over(
        rgba(color),
        kind === "ring" || kind === "fill" ? bg : backdrop,
      );
      const luminance = (rgb: number[]) =>
        rgb
          .slice(0, 3)
          .reduce(
            (sum, v, i) =>
              sum +
              (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4) *
                [0.2126, 0.7152, 0.0722][i],
            0,
          );
      const [low, high] = [luminance(fg), luminance(bg)].sort((a, b) => a - b);
      return {
        kind,
        color,
        foreground: fg,
        background: bg,
        ratio: (high + 0.05) / (low + 0.05),
        shadow: kind === "ring" ? style.boxShadow : undefined,
      };
    }, kind);
}
