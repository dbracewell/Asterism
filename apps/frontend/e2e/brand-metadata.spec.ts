import { expect, test } from "./support/test";

// US-41.6: favicon, touch icon, manifest and link preview are public and wired
// into metadata (crawlers and install prompts fetch them without a session).
test("serves brand icons, manifest and link preview without a session", async ({
  page,
  request,
}) => {
  await page.goto("/sign-in");
  const head = page.locator("head");
  await expect(head.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest",
  );
  await expect(head.locator('meta[property="og:image:alt"]')).toHaveAttribute(
    "content",
    "Asterism — Where will your curiosity lead you today?",
  );
  await expect(head.locator('meta[name="twitter:card"]')).toHaveAttribute(
    "content",
    "summary_large_image",
  );
  const ogImage = await head
    .locator('meta[property="og:image"]')
    .getAttribute("content");
  expect(new URL(ogImage!).pathname).toBe("/opengraph-image.png");

  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  const { icons, name, theme_color } = await manifest.json();
  expect(name).toBe("Asterism");
  expect(theme_color).toBe("#3b5bdb");
  expect(icons.map((icon: { sizes: string }) => icon.sizes)).toEqual([
    "192x192",
    "512x512",
    "512x512",
  ]);

  const hrefs = await head
    .locator('link[rel~="icon"], link[rel="apple-touch-icon"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")!));
  for (const path of [
    ...hrefs,
    ...icons.map((icon: { src: string }) => icon.src),
    new URL(ogImage!).pathname,
  ]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(200);
    expect(response.headers()["content-type"], path).toMatch(/^image\//);
  }
});
