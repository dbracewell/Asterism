// Regenerates raster app icons from src/app/icon.svg (the single source of truth).
// Outputs Next.js metadata files: src/app/favicon.ico (16/32/48) and src/app/apple-icon.png (180).
// Usage: pnpm --filter @asterism/frontend generate:icons
import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const appDir = fileURLToPath(new URL("../src/app/", import.meta.url));
const svg = await readFile(`${appDir}icon.svg`, "utf8");

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const render = async (size, markup = svg) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${markup}`,
    );
    return page.screenshot({ omitBackground: true, type: "png" });
  };

  const icoSizes = [16, 32, 48];
  const pngs = [];
  for (const size of icoSizes) pngs.push(await render(size));
  await writeFile(`${appDir}favicon.ico`, encodeIco(icoSizes, pngs));
  // iOS applies its own corner mask, so the touch icon must be an opaque full-bleed square.
  const fullBleed = svg.replace(/(<rect\b[^>]*?)\s+rx="[^"]*"/, "$1");
  await writeFile(`${appDir}apple-icon.png`, await render(180, fullBleed));
} finally {
  await browser.close();
}

/** Builds a PNG-embedded ICO container (supported by all current browsers). */
function encodeIco(sizes, images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((png, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(sizes[i] % 256, entry); // width (0 means 256)
    header.writeUInt8(sizes[i] % 256, entry + 1); // height
    header.writeUInt16LE(1, entry + 4); // color planes
    header.writeUInt16LE(32, entry + 6); // bits per pixel
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images]);
}
