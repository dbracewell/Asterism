import { expect, Page, test } from "@playwright/test";

const providerId = "20000000-0000-4000-8000-000000000001";

async function routeProviderApi(page: Page) {
  await page.route("**/api/auth/**", (route) =>
    route.fulfill({ status: 200, json: { token: "e2e-token" } }),
  );
  await page.route("**/api/py/settings/app/providers", (route) =>
    route.fulfill({
      status: 200,
      json: {
        draft_model_id: null,
        llm_providers: [
          {
            id: providerId,
            name: "Large catalog",
            provider_type: "generic_openai",
            base_url: "http://localhost:8080/v1",
            api_key: "secret",
            model_count: 1_000,
            active_model_count: 50,
          },
        ],
      },
    }),
  );
  await page.route(
    `**/api/py/settings/app/providers/${providerId}/models?**`,
    (route) =>
      route.fulfill({
        status: 200,
        json: {
          total: 1_000,
          next_cursor: "10000000-0000-4000-8000-000000000050",
          models: Array.from({ length: 50 }, (_, index) => ({
            id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
            provider_id: providerId,
            name: `model-${index}`,
            is_active: true,
            context_window: null,
            supports_vision: null,
            context_window_source: "unknown",
            vision_source: "unknown",
          })),
        },
      }),
  );
}

test("does not mount a large catalog until it is opened", async ({ page }) => {
  await routeProviderApi(page);
  await page.goto("/e2e/providers?t=admin&setting=providers&keep=current");

  await expect(
    page.getByRole("button", { name: "Browse 1,000 models" }),
  ).toBeVisible();
  await expect(page.getByPlaceholder("Search models")).toHaveCount(0);

  await page.getByRole("button", { name: "Browse 1,000 models" }).click();
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("provider") === providerId &&
      url.searchParams.get("t") === "admin" &&
      url.searchParams.get("setting") === "providers" &&
      url.searchParams.get("keep") === "current",
  );
  await expect(page.getByPlaceholder("Search models")).toBeVisible();
  await expect(
    page.getByText("1,000 matching models · 50 per page"),
  ).toBeVisible();
  await expect(page.getByText("model-49")).toBeVisible();
  await expect(page.getByText("model-50")).toHaveCount(0);
});

test("persists explicit tool-call support through the admin model control", async ({
  page,
}) => {
  await routeProviderApi(page);
  let saved: unknown;
  await page.route(
    `**/api/py/settings/app/providers/${providerId}/models/10000000-0000-4000-8000-000000000000`,
    (route) => {
      saved = route.request().postDataJSON();
      return route.fulfill({
        json: {
          id: "10000000-0000-4000-8000-000000000000",
          name: "model-0",
          provider_id: providerId,
          ...(saved as object),
        },
      });
    },
  );
  await page.goto("/e2e/providers");
  await page.getByRole("button", { name: "Browse 1,000 models" }).click();
  await page.getByLabel("Tool calls", { exact: true }).first().click();
  await page.getByRole("option", { name: "Supported", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).first().click();
  await expect
    .poll(() => saved)
    .toMatchObject({ supports_tools: true, tools_source: "manual" });
});

for (const width of [390, 1100]) {
  test(`keeps model capabilities and the shared Save inside a narrow panel at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await routeProviderApi(page);
    const saved: Array<Record<string, unknown>> = [];
    await page.route(
      `**/api/py/settings/app/providers/${providerId}/models/*`,
      (route) => {
        const body = route.request().postDataJSON();
        saved.push(body);
        return route.fulfill({
          json: {
            id: route.request().url().split("/").at(-1),
            provider_id: providerId,
            name: "model",
            ...body,
          },
        });
      },
    );
    await page.goto("/e2e/providers");
    if (width > 1000) {
      // A wide viewport can still contain a narrow settings panel.
      await page.locator("main").evaluate((element) => {
        element.style.maxWidth = "640px";
      });
    }
    await page.getByRole("button", { name: "Browse 1,000 models" }).click();
    for (const label of ["Vision input", "Tool calls"]) {
      const control = page.getByLabel(label, { exact: true }).first();
      await control.scrollIntoViewIfNeeded();
      const bounds = await control.boundingBox();
      const panel = await page.locator("main").boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(panel!.x);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
        panel!.x + panel!.width,
      );
      await control.click();
      await page
        .getByRole("option", { name: "Supported", exact: true })
        .click();
    }
    await page
      .getByLabel("Context window", { exact: true })
      .nth(1)
      .fill("8192");
    expect(saved).toHaveLength(0);
    const save = page.getByRole("button", { name: "Save", exact: true });
    await expect(save).toHaveCount(1);
    await expect(save).toBeInViewport();
    await save.click();
    await expect.poll(() => saved.length).toBe(2);
    expect(saved[0]).toMatchObject({
      supports_tools: true,
      supports_vision: true,
      tools_source: "manual",
      vision_source: "manual",
    });
    expect(saved[1]).toMatchObject({
      context_window: 8192,
      context_window_source: "manual",
    });
    expect(
      await page
        .locator("main")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
  });
}
