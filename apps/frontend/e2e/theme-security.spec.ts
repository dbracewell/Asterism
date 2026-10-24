import { expect, test } from "./support/test";

test("public catalog rejects traversal and preserves sign-in theme selection", async ({
  page,
  context,
}) => {
  const catalog = await page.request.get("/api/theme/list");
  expect(catalog.status()).toBe(200);
  const entries: { filename: string; name: string }[] = await catalog.json();
  expect(entries.some((theme) => theme.filename === "dark")).toBe(true);
  for (const id of [
    "../package",
    "../../package",
    "/etc/passwd",
    "light.json",
    "..\\package",
  ]) {
    const response = await page.request.get(
      `/api/theme?name=${encodeURIComponent(id)}`,
    );
    expect(response.status()).toBe(400);
    expect(await response.text()).not.toContain('"dependencies"');
  }
  const palette = await page.request.get("/api/theme?name=dark");
  expect(palette.status()).toBe(200);
  const dark = await palette.json();
  await context.addCookies([
    {
      name: "asterism-custom-theme-name",
      value: "dark",
      url: "http://localhost:3100",
    },
  ]);
  await page.goto("/sign-in");
  await expect(page.locator("body")).toHaveClass(/dark/);
  await expect(page.locator("body")).toHaveCSS(
    "--background",
    dark.colors.background,
  );
  await context.addCookies([
    {
      name: "asterism-custom-theme-name",
      value: "constructor",
      url: "http://localhost:3100",
    },
  ]);
  await page.reload();
  await expect(page.locator("body")).not.toHaveClass(/dark/);
  await expect(page.getByRole("heading", { name: "ASTERISM" })).toBeVisible();
});
