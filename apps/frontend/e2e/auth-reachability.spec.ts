import { expect, request, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  authViewports,
  exerciseAuth,
  expectAuthFits,
  expectReachable,
} from "./support/auth-reachability";

const accountEmail = `${randomUUID()}@example.test`;
const accountPassword = "Reachability-321!";
test.use({ hasTouch: true });
test.beforeAll(async () => {
  if (process.env.ASTERISM_ISOLATED_E2E !== "true") return;
  // A separate API context creates a user after fresh-install tests, leaving each
  // browser anonymous so /sign-in selects the real login view.
  const account = await request.newContext({
    baseURL: "http://localhost:3100",
  });
  try {
    const response = await account.post(
      `/api/auth/sign-up/email?adminKey=${encodeURIComponent(process.env.ADMIN_PASSPHRASE!)}`,
      {
        data: {
          name: "Reachability",
          email: accountEmail,
          password: accountPassword,
        },
      },
    );
    expect(response.ok()).toBeTruthy();
    const user = (await response.json()).user;
    const provision = await account.post("/api/py/users/", {
      data: { user_id: user.id, system_key: process.env.SYSTEM_KEY },
    });
    expect(provision.ok()).toBeTruthy();
  } finally {
    await account.dispose();
  }
});
for (const scenario of authViewports) {
  test(`login controls, errors and keyboard focus at ${scenario.width}x${scenario.height}, ${(scenario.fontSize / 16) * 100}% text`, async ({
    page,
  }, info) => {
    test.skip(
      process.env.ASTERISM_ISOLATED_E2E !== "true",
      "Use the isolated auth/storage runner",
    );
    await exerciseAuth(page, scenario, false, info);
  });
}
test("a long unbroken login error wraps, scrolls and leaves fields/submit reachable", async ({
  page,
  context,
}) => {
  test.skip(
    process.env.ASTERISM_ISOLATED_E2E !== "true",
    "Use the isolated auth/storage runner",
  );
  await context.addCookies([
    { name: "asterism-font-size", value: "32px", url: "http://localhost:3100" },
  ]);
  await page.setViewportSize({ width: 320, height: 300 });
  await page.route("**/api/auth/sign-in/email", (route) =>
    route.fulfill({
      status: 401,
      json: {
        code: "INVALID_CREDENTIALS",
        message: "Long error " + "longmessage".repeat(40),
      },
    }),
  );
  await page.goto("/sign-in");
  const form = page.getByRole("form", { name: "Sign in", exact: true });
  await form.getByLabel("Email").fill("absent-321@example.test");
  await form.getByLabel("Password", { exact: true }).fill("Reachability-321!");
  await form.getByRole("button", { name: "Login" }).tap();
  const error = form.getByRole("alert");
  await expect(error).toBeFocused();
  await expect(error).toContainText("Long error");
  expect(
    await error.evaluate((node) => node.getBoundingClientRect().top),
  ).toBeGreaterThanOrEqual(4);
  await expectAuthFits(page);
  await page.keyboard.press("Tab");
  await expect(form.getByLabel("Email")).toBeFocused();
  await expectReachable(form.getByLabel("Email"), true);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expectReachable(form.getByRole("button", { name: "Login" }), true);
});
test("a focused login can shrink to a keyboard-sized viewport and recover", async ({
  page,
}) => {
  test.skip(
    process.env.ASTERISM_ISOLATED_E2E !== "true",
    "Use the isolated auth/storage runner",
  );
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/sign-in");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const form = page.getByRole("form", { name: "Sign in", exact: true });
  await expect(form.getByLabel("Password", { exact: true })).toBeFocused();
  await page.setViewportSize({ width: 390, height: 300 });
  await page.keyboard.press("Tab");
  await expectReachable(form.getByRole("button", { name: "Login" }), true);
  await expectAuthFits(page);
  await page.setViewportSize({ width: 390, height: 800 });
  await expectAuthFits(page);
});

test("successful login remains reachable at 320x300 with 200% text", async ({
  page,
  context,
}) => {
  test.skip(
    process.env.ASTERISM_ISOLATED_E2E !== "true",
    "Use the isolated auth/storage runner",
  );
  await context.addCookies([
    { name: "asterism-font-size", value: "32px", url: "http://localhost:3100" },
  ]);
  await page.setViewportSize({ width: 320, height: 300 });
  await page.goto("/sign-in?redirect=%2Fe2e%2Fthemes");
  const form = page.getByRole("form", { name: "Sign in", exact: true });
  await form.getByLabel("Email").fill(accountEmail);
  await form.getByLabel("Password", { exact: true }).fill(accountPassword);
  await page
    .getByRole("main", { name: "Authentication" })
    .hover({ position: { x: 8, y: 8 } });
  await page.mouse.wheel(0, 10000);
  await expect(form.getByRole("button", { name: "Login" })).toBeInViewport({
    ratio: 1,
  });
  await expectReachable(form.getByRole("button", { name: "Login" }));
  await form.getByRole("button", { name: "Login" }).tap();
  await expect(page).toHaveURL(/\/e2e\/themes$/);
  const session = await context.request.get("/api/auth/get-session");
  expect((await session.json()).user.email).toBe(accountEmail);
  await expect(page.getByRole("main", { name: "Authentication" })).toHaveCount(
    0,
  );
});
