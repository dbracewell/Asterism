import {
  expect,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";

export const authViewports = [320, 390]
  .flatMap((width) =>
    [300, 800].flatMap((height) =>
      [16, 32].map((fontSize) => ({ width, height, fontSize })),
    ),
  )
  .concat([16, 32].map((fontSize) => ({ width: 640, height: 300, fontSize })));

export async function expectReachable(control: Locator, keyboard = false) {
  const geometry = await control.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const hit = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    const style = getComputedStyle(node);
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: innerWidth,
      height: innerHeight,
      hit: hit === node || node.contains(hit),
      focus: node === document.activeElement,
      focusVisible:
        style.boxShadow !== "none" ||
        (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0),
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(4);
  expect(geometry.right).toBeLessThanOrEqual(geometry.width - 4);
  expect(geometry.top).toBeGreaterThanOrEqual(4);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.height - 4);
  expect(geometry.hit).toBe(true);
  if (keyboard) {
    expect(geometry.focus).toBe(true);
    expect(geometry.focusVisible).toBe(true);
  }
}

export async function expectAuthFits(page: Page) {
  const result = await page
    .getByRole("main", { name: "Authentication" })
    .evaluate((node) => ({
      width: node.clientWidth,
      scrollWidth: node.scrollWidth,
      height: node.clientHeight,
      viewportHeight: innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
      overflowX: getComputedStyle(node).overflowX,
    }));
  expect(result.scrollWidth).toBeLessThanOrEqual(result.width + 1);
  expect(result.documentWidth).toBeLessThanOrEqual(result.viewportWidth + 1);
  expect(result.height).toBe(result.viewportHeight);
  expect(["hidden", "clip"]).not.toContain(result.overflowX);
}

export async function exerciseAuth(
  page: Page,
  scenario: { width: number; height: number; fontSize: number },
  setup: boolean,
  info: TestInfo,
) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.context().addCookies([
    {
      name: "asterism-font-size",
      value: `${scenario.fontSize}px`,
      url: "http://localhost:3100",
    },
  ]);
  await page.setViewportSize(scenario);
  await page.goto("/sign-in");
  const form = page.getByRole("form", {
    name: setup ? "Administrator setup" : "Sign in",
    exact: true,
  });
  const controls = setup
    ? [
        form.getByLabel("Name", { exact: true }),
        form.getByLabel("Email"),
        form.getByLabel("Password", { exact: true }),
        form.getByLabel("Admin Passkey"),
        form.getByRole("button", { name: "Sign up" }),
      ]
    : [
        form.getByLabel("Email"),
        form.getByLabel("Password", { exact: true }),
        form.getByRole("button", { name: "Login" }),
      ];
  await expect(form).toBeVisible();
  await expect(page.locator("html")).toHaveCSS(
    "font-size",
    `${scenario.fontSize}px`,
  );
  await expectAuthFits(page);
  const viewport = await page
    .locator('meta[name="viewport"]')
    .getAttribute("content");
  expect(viewport).toContain("interactive-widget=resizes-content");
  expect(viewport).not.toMatch(/user-scalable=no|maximum-scale=1(?:,|$)/);
  for (const control of controls) {
    await page.keyboard.press("Tab");
    await expect(control).toBeFocused();
    await expectReachable(control, true);
  }
  await form.getByLabel("Email").fill("absent-321@example.test");
  await form.getByLabel("Password", { exact: true }).fill("Reachability-321!");
  const scroll = page.getByRole("main", { name: "Authentication" });
  await scroll.hover({ position: { x: 8, y: 8 } });
  await page.mouse.wheel(0, 10000);
  const submit = controls.at(-1)!;
  await expect(submit).toBeInViewport({ ratio: 1 });
  await expectReachable(submit);
  await submit.tap();
  const error = form.getByRole("alert");
  await expect(error).toBeFocused();
  await expect(error).toContainText(
    setup ? "Name and Admin Passkey required" : /invalid|incorrect/i,
  );
  await expectReachable(error);
  await expectAuthFits(page);
  // The summary is programmatically focused, then ordinary Tab reaches each field
  // and the submit button, scrolling the same auth owner as needed.
  for (const control of controls) {
    await page.keyboard.press("Tab");
    await expect(control).toBeFocused();
    await expectReachable(control, true);
  }
  await page.keyboard.press("Enter");
  await expect(error).toBeFocused();
  await expectReachable(error, true);
  expect(errors).toEqual([]);
  if (
    scenario.width === 320 &&
    scenario.height === 300 &&
    scenario.fontSize === 32
  ) {
    await page.screenshot({
      path: info.outputPath(
        `${setup ? "setup" : "login"}-320x300-200percent.png`,
      ),
    });
  }
}
