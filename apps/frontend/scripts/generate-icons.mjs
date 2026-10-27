// Regenerates raster app icons from src/app/icon.svg (the single source of truth).
// Outputs Next.js metadata files: src/app/favicon.ico (16/32/48), src/app/apple-icon.png (180)
// and src/app/opengraph-image.png (1200x630), plus web manifest icons in public/:
// icon-192.png, icon-512.png and icon-maskable-512.png.
// Usage: pnpm --filter @asterism/frontend generate:icons
import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const appDir = fileURLToPath(new URL("../src/app/", import.meta.url));
const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
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
  // iOS and Android maskable icons apply their own corner mask: drop the tile radius.
  const fullBleed = svg.replace(/(<rect\b[^>]*?)\s+rx="[^"]*"/, "$1");

  const icoSizes = [16, 32, 48];
  const pngs = [];
  for (const size of icoSizes) pngs.push(await render(size));
  await writeFile(`${appDir}favicon.ico`, encodeIco(icoSizes, pngs));
  await writeFile(`${appDir}apple-icon.png`, await render(180, fullBleed));

  for (const size of [192, 512]) {
    await writeFile(`${publicDir}icon-${size}.png`, await render(size));
  }
  // Maskable icons keep the mark inside the central 80% safe zone.
  const maskable = fullBleed
    .replace(
      /<g /,
      '<g transform="translate(166 112) scale(0.8) translate(-166 -112)" ',
    )
    .replace(
      /(<\/g>\s*)<g /,
      '$1<g transform="translate(166 112) scale(0.8) translate(-166 -112)" ',
    );
  await writeFile(
    `${publicDir}icon-maskable-512.png`,
    await render(512, maskable),
  );

  await writeFile(`${appDir}opengraph-image.png`, await renderOpenGraph(page));
} finally {
  await browser.close();
}

/** Link preview card in the Night Atlas palette: mark, wordmark and tagline. */
async function renderOpenGraph(page) {
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(`
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;600&display=block">
    <style>
      html, body { margin: 0; width: 1200px; height: 630px; }
      body {
        display: flex; align-items: center; gap: 64px; padding: 0 112px; box-sizing: border-box;
        background: radial-gradient(circle at 18% 30%, #182038 0, #0e1424 60%);
        font-family: "Schibsted Grotesk", sans-serif; color: #dce3f5;
      }
      svg { width: 260px; height: 260px; flex: none; }
      h1 { margin: 0; font-size: 120px; font-weight: 600; letter-spacing: -0.02em; line-height: 1; }
      p { margin: 24px 0 0; font-size: 40px; color: #9aa6c4; line-height: 1.25; text-wrap: balance; }
    </style>
    ${svg}
    <div><h1>Asterism</h1><p>Where will your curiosity lead you today?</p></div>
  `);
  await page.evaluate(() => document.fonts.ready);
  if (
    !(await page.evaluate(() =>
      document.fonts.check('600 120px "Schibsted Grotesk"'),
    ))
  ) {
    throw new Error(
      "Schibsted Grotesk did not load; the Open Graph image needs network access",
    );
  }
  return page.screenshot({ type: "png" });
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
