import { ApplicationSettings } from "@/lib/client";
import { expect, Page, test } from "@playwright/test";

const modelId = "10000000-0000-4000-8000-000000000001";

const emptySettings = (): ApplicationSettings => ({
  llm_providers: [],
  draft_model_id: null,
  web_search_provider: null,
  image_search_provider: null,
  active_tools: [],
});

async function routeProviderApi(page: Page) {
  let settings = emptySettings();

  await page.route("**/api/auth/**", (route) =>
    route.fulfill({ status: 200, json: { token: "e2e-token" } }),
  );
  await page.route("**/api/py/settings/app", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, json: settings });
      return;
    }
    const request = route.request().postDataJSON();
    settings = {
      ...settings,
      ...request.values,
    };
    await route.fulfill({ status: 200, json: settings });
  });

  return {
    settings: () => settings,
  };
}

async function addProvider(page: Page, name: string, apiKey: string) {
  await page.getByRole("button", { name: "Add provider", exact: true }).click();
  await page.getByLabel("Provider Name").fill(name);
  await page.getByLabel("API Key").fill(apiKey);
}

async function selectOption(page: Page, label: string, option: string) {
  const trigger = page.getByLabel(label);
  await trigger.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("configures OpenAI discovery and retains the draft model after reload", async ({
  page,
}) => {
  const api = await routeProviderApi(page);
  await page.route(
    "**/api/py/settings/app/providers/discover",
    async (route) => {
      const request = route.request().postDataJSON();
      expect(request.provider_type).toBe("openai");
      expect(request.base_url).toBe("https://api.openai.com/v1");
      await route.fulfill({
        status: 200,
        json: {
          catalog_version: "e2e-catalog",
          warnings: [],
          models: [
            {
              id: modelId,
              provider_id: request.provider_id,
              name: "gpt-4o",
              is_active: true,
              context_window: 128000,
              supports_vision: true,
              context_window_source: "catalog",
              vision_source: "catalog",
            },
          ],
        },
      });
    },
  );

  await page.goto("/e2e/providers");
  await addProvider(page, "OpenAI", "openai-key");
  await selectOption(page, "Provider type for provider 1", "OpenAI");

  await expect(page.getByLabel("Base URL")).toHaveValue(
    "https://api.openai.com/v1",
  );
  await expect(page.getByLabel("Base URL")).toHaveAttribute("readonly", "");
  await page.getByRole("button", { name: "Load models" }).click();
  await expect(page.getByLabel("gpt-4o", { exact: true })).toBeVisible();
  await expect(page.getByText("Source: catalog").first()).toBeVisible();

  await page.getByRole("button", { name: "Save" }).click();
  await expect.poll(() => api.settings().draft_model_id).toBe(modelId);
  await page.reload();

  await expect(page.getByLabel("Provider Name")).toHaveValue("OpenAI");
  await expect(
    page.getByRole("button", { name: "gpt-4o", exact: true }),
  ).toBeVisible();
});

test("completes unknown Generic OpenAI capabilities manually and reloads them", async ({
  page,
}) => {
  const api = await routeProviderApi(page);
  await page.route(
    "**/api/py/settings/app/providers/discover",
    async (route) => {
      const request = route.request().postDataJSON();
      expect(request.provider_type).toBe("generic_openai");
      expect(request.base_url).toBe("http://localhost:11434/v1");
      await route.fulfill({
        status: 200,
        json: {
          warnings: [
            "local-model: context window is unknown.",
            "local-model: vision support is unknown.",
          ],
          models: [
            {
              id: modelId,
              provider_id: request.provider_id,
              name: "local-model",
              is_active: true,
              context_window: null,
              supports_vision: null,
              context_window_source: "unknown",
              vision_source: "unknown",
            },
          ],
        },
      });
    },
  );

  await page.goto("/e2e/providers");
  await addProvider(page, "Local", "local-key");
  await page.getByLabel("Base URL").fill("http://localhost:11434/v1");
  await page.getByRole("button", { name: "Load models" }).click();

  await expect(page.getByText("Source: unknown").first()).toBeVisible();
  await page.getByLabel("Context window").fill("32768");
  await selectOption(page, "Vision input", "Not supported");
  await expect(page.getByText("Source: manual").first()).toBeVisible();

  await page.getByRole("button", { name: "Save" }).click();
  await expect
    .poll(() => api.settings().llm_providers?.[0]?.models[0]?.context_window)
    .toBe(32768);
  await page.reload();

  await expect(page.getByLabel("Context window")).toHaveValue("32768");
  await expect(page.getByLabel("Vision input")).toContainText("Not supported");
  await expect(page.getByText("Source: manual").first()).toBeVisible();
});

test("shows a backend discovery failure instead of an empty model list", async ({
  page,
}) => {
  await routeProviderApi(page);
  await page.route("**/api/py/settings/app/providers/discover", (route) =>
    route.fulfill({
      status: 502,
      json: {
        code: 502,
        detail:
          "authentication_failed: Provider rejected the supplied credentials.",
      },
    }),
  );

  await page.goto("/e2e/providers");
  await addProvider(page, "Broken", "wrong-key");
  await page.getByLabel("Base URL").fill("https://provider.example/v1");
  await page.getByRole("button", { name: "Load models" }).click();

  await expect(
    page.getByText(/authentication_failed: Provider rejected/),
  ).toBeVisible();
  await expect(page.getByText("No models loaded yet.")).toBeVisible();
});
