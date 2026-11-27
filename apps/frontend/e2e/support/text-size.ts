import type { Page } from "@playwright/test";

/**
 * Enlarges the page's root text the way a person's browser setting would,
 * before the first paint. The font-size preference cookie only accepts the
 * sizes Settings offers (US-116.2), so tests no longer set 32px through it.
 */
export async function setRootTextSize(page: Page, pixels: number) {
  await page.addInitScript((size) => {
    const apply = () => {
      const style = document.createElement("style");
      style.dataset.e2eTextSize = "";
      style.textContent = `html { font-size: ${size}px !important; }`;
      document.head.append(style);
    };
    if (document.head) apply();
    else document.addEventListener("DOMContentLoaded", apply, { once: true });
  }, pixels);
}
