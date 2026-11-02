import { expect, test } from "./support/test";
import {
  FOREIGN_ID,
  GONE_ID,
  INLINE_CHAT,
  PNG_ID,
  SVG_ID,
} from "../src/app/e2e/inline-files/inline-files-harness";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="40" height="40">
  <script>window.top.__svgRan = true; fetch('/untrusted-svg/script');</script>
  <image href="/untrusted-svg/image" width="10" height="10"/>
  <rect width="40" height="40" fill="teal" onload="window.top.__svgRan = true"/>
</svg>`;

test("inline files load only through the scoped route and active content stays inert", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/py/") || /untrusted/.test(url.href))
      requests.push(`${url.pathname}${url.search}`);
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/auth/token", (route) =>
    route.fulfill({ json: { token: "fixture-only" } }),
  );
  await page.route(/untrusted/, (route) => route.fulfill({ status: 204 }));
  await page.route("**/api/py/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === `/api/py/chat/${INLINE_CHAT}/files/${PNG_ID}`)
      return route.fulfill({ body: PNG, contentType: "image/png" });
    if (pathname === `/api/py/chat/${INLINE_CHAT}/files/${SVG_ID}`)
      return route.fulfill({ body: SVG, contentType: "image/svg+xml" });
    return route.fulfill({ status: 404, json: { detail: "File not found" } });
  });

  await page.goto("/e2e/inline-files");
  const reply = page.getByRole("region", {
    name: "Resolved reply",
    exact: true,
  });
  const chart = reply.getByRole("img", { name: "Quarterly chart" });
  const drawing = reply.getByRole("img", { name: "Script drawing" });
  await expect(chart).toBeVisible();
  await expect(drawing).toBeVisible();
  await expect(chart).toHaveAttribute("src", /^blob:/);
  await expect(drawing).toHaveAttribute("src", /^blob:/);
  // Both images decoded; the SVG ran as an image only.
  await expect
    .poll(() => chart.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await expect
    .poll(() => drawing.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);

  await expect(
    reply.getByText("File unavailable: Foreign image"),
  ).toBeVisible();
  await expect(reply.getByText("File unavailable: foreign link")).toBeVisible();
  await expect(
    reply.getByText("File unavailable: Deleted image"),
  ).toBeVisible();
  await expect(reply.getByText("[Image omitted: Shaped]")).toBeVisible();
  await expect(reply.getByText("[Image omitted: query]")).toBeVisible();
  await expect(reply.getByText("[Image omitted: remote]")).toBeVisible();
  await expect(reply.getByRole("link", { name: "shaped link" })).toHaveCount(0);
  await expect(
    page
      .getByRole("region", { name: "Unresolved reply", exact: true })
      .getByText("File unavailable: Quarterly chart"),
  ).toBeVisible();

  // Lightbox reuses the scoped bytes and offers a download.
  await reply
    .getByRole("button", { name: "Open image Quarterly chart" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("img", { name: "Quarterly chart" }),
  ).toBeVisible();
  await expect(dialog).toContainText("Download");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.waitForTimeout(300);
  expect(await page.evaluate(() => "__svgRan" in window)).toBe(false);
  expect([...new Set(requests)].sort()).toEqual(
    [
      `/api/py/chat/${INLINE_CHAT}/files/${PNG_ID}`,
      `/api/py/chat/${INLINE_CHAT}/files/${SVG_ID}`,
    ].sort(),
  );
  expect(requests.join(" ")).not.toContain(FOREIGN_ID);
  expect(requests.join(" ")).not.toContain(GONE_ID);
  expect(
    await reply.evaluate((root) =>
      [...root.querySelectorAll("[href],[src]")]
        .map((el) => el.getAttribute("href") ?? el.getAttribute("src") ?? "")
        .filter((value) => !value.startsWith("blob:")),
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
});
