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
  await page.goto("/e2e/providers");

  await expect(
    page.getByRole("button", { name: "Browse 1,000 models" }),
  ).toBeVisible();
  await expect(page.getByPlaceholder("Search models")).toHaveCount(0);

  await page.getByRole("button", { name: "Browse 1,000 models" }).click();
  await expect(page.getByPlaceholder("Search models")).toBeVisible();
  await expect(
    page.getByText("1,000 matching models · 50 per page"),
  ).toBeVisible();
  await expect(page.getByText("model-49")).toBeVisible();
  await expect(page.getByText("model-50")).toHaveCount(0);
});
