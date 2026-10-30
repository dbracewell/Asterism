import { expect, type Page, test } from "./support/test";
import {
  authViewports,
  expectAuthFits,
  expectReachable,
} from "./support/auth-reachability";
import { measure } from "./support/contrast";
import { themes } from "./support/theme-matrix";

const origin = "http://localhost:3100";

type Provider = {
  id: string;
  name: string;
  provider_type: string;
  base_url: string;
  api_key: string;
};

/**
 * In-memory provider APIs: discovery fails `failures` times, then finds three
 * models. Records model updates and the saved default model.
 */
async function routeSetupApi(page: Page, failures = 0) {
  const state = {
    providers: [] as Provider[],
    discovered: false,
    failures,
    saves: [] as Provider[][],
    activated: [] as string[],
    defaultModel: null as unknown,
  };
  const models = () =>
    state.discovered
      ? ["alpha-chat", "beta-vision", "gamma-tools"].map((name, index) => ({
          id: `30000000-0000-4000-8000-00000000000${index}`,
          name,
          provider_id: state.providers[0].id,
          is_active: false,
          context_window: null,
          supports_vision: index === 1,
          supports_tools: index === 2,
          context_window_source: "unknown",
          tools_source: "unknown",
          vision_source: "unknown",
        }))
      : [];
  await page.route("**/api/auth/**", (route) =>
    route.fulfill({ status: 200, json: { token: "e2e-token" } }),
  );
  await page.route("**/api/py/settings/app/providers", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      state.providers = body.llm_providers;
      state.saves.push(body.llm_providers);
    }
    await route.fulfill({
      json: {
        draft_model_id: null,
        llm_providers: state.providers.map((provider) => ({
          ...provider,
          api_key: "**********",
          model_count: models().length,
          active_model_count: 0,
        })),
      },
    });
  });
  await page.route(
    "**/api/py/settings/app/providers/*/models/discover",
    async (route) => {
      if (state.failures > 0) {
        state.failures -= 1;
        return route.fulfill({
          status: 502,
          json: {
            detail:
              "connectivity: Could not connect to the provider model endpoint.",
          },
        });
      }
      state.discovered = true;
      await route.fulfill({
        json: { ...state.providers[0], model_count: 3, active_model_count: 0 },
      });
    },
  );
  await page.route(
    "**/api/py/settings/app/providers/*/models?**",
    async (route) => {
      const query = new URL(route.request().url()).searchParams.get("query");
      const matching = models().filter((model) =>
        model.name.includes(query ?? ""),
      );
      await route.fulfill({
        json: { models: matching, total: matching.length, next_cursor: null },
      });
    },
  );
  await page.route(
    "**/api/py/settings/app/providers/*/models/*",
    async (route) => {
      if (route.request().url().endsWith("/discover")) return route.fallback();
      state.activated.push(route.request().url().split("/").at(-1)!);
      await route.fulfill({ json: {} });
    },
  );
  await page.route(
    "**/api/py/settings/user/default_model_id",
    async (route) => {
      state.defaultModel = route.request().postDataJSON().value;
      await route.fulfill({ json: {} });
    },
  );
  // The new-chat page is outside this harness; stand in for it.
  await page.route(
    (url) => url.origin === origin && url.pathname === "/",
    (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<main><h1>New chat stand-in</h1></main>",
      }),
  );
  return state;
}

const connectForm = (page: Page) =>
  page.getByRole("form", { name: "Add a model provider" });
const modelsForm = (page: Page) =>
  page.getByRole("form", { name: "Enable models" });

async function connectGeneric(page: Page) {
  const form = connectForm(page);
  await form.getByRole("radio", { name: "OpenAI-compatible" }).click();
  await form.getByLabel("Provider name").fill("Local models");
  await form.getByLabel("Base URL").fill("http://localhost:11434/v1");
  await form.getByLabel("API key").fill("local-key");
  await form
    .getByRole("button", { name: "Connect and discover models" })
    .click();
}

test("the provider step is the current setup step in the setup card", async ({
  page,
}) => {
  await routeSetupApi(page);
  await page.goto("/e2e/provider-setup");
  await expect(page.getByRole("heading", { name: "ASTERISM" })).toBeVisible();
  const steps = page.getByRole("list", { name: "First-run setup" });
  await expect(steps.getByRole("listitem").first()).toContainText("(complete)");
  await expect(steps.locator('[aria-current="step"]')).toContainText(
    "Add a model provider",
  );
  await expect(
    connectForm(page).getByRole("radio", { name: "OpenAI", exact: true }),
  ).toBeChecked();
  await expect(connectForm(page).getByLabel("Base URL")).toHaveValue(
    "https://api.openai.com/v1",
  );
  await expect(connectForm(page).getByLabel("Base URL")).not.toBeEditable();
});

test("a discovery failure keeps the entered values and retries", async ({
  page,
}) => {
  const state = await routeSetupApi(page, 1);
  await page.goto("/e2e/provider-setup");
  await connectGeneric(page);
  const alert = connectForm(page).getByRole("alert");
  await expect(alert).toBeFocused();
  await expect(alert).toContainText(
    "Model discovery failed. Could not connect to the provider model endpoint.",
  );
  await expect(connectForm(page).getByLabel("Provider name")).toHaveValue(
    "Local models",
  );
  await expect(connectForm(page).getByLabel("API key")).toHaveValue(
    "local-key",
  );
  await connectForm(page).getByRole("button", { name: "Retry" }).click();
  await expect(modelsForm(page)).toBeVisible();
  expect(state.saves).toHaveLength(2);
  expect(state.saves[1]).toHaveLength(1);
  expect(state.saves[1][0].id).toBe(state.saves[0][0].id);
});

test("enabling models shows the ready step, which opens the new-chat page", async ({
  page,
}) => {
  const state = await routeSetupApi(page);
  await page.goto("/e2e/provider-setup");
  await connectGeneric(page);
  const form = modelsForm(page);
  await expect(form.getByRole("img", { name: "Vision input" })).toBeVisible();
  await expect(form.getByRole("img", { name: "Tool calling" })).toBeVisible();
  await form.getByLabel("alpha-chat").check();
  await form.getByLabel("gamma-tools").check();
  await form.getByLabel("Default model").click();
  await page.getByRole("option", { name: "gamma-tools" }).click();
  await form.getByRole("button", { name: "Continue" }).click();
  const steps = page.getByRole("list", { name: "First-run setup" });
  await expect(steps.locator('[aria-current="step"]')).toContainText(
    "Start your first chat",
  );
  await expect(page.getByRole("status")).toHaveText(
    "You're ready to start your exploration.",
  );
  const start = page.getByRole("button", { name: "Start chatting" });
  await expect(start).toBeFocused();
  await expect(page).toHaveURL(/\/e2e\/provider-setup$/);
  await start.click();
  await expect(page).toHaveURL(`${origin}/`);
  await expect(
    page.getByRole("heading", { name: "New chat stand-in" }),
  ).toBeVisible();
  expect(state.activated).toEqual([
    "30000000-0000-4000-8000-000000000000",
    "30000000-0000-4000-8000-000000000002",
  ]);
  expect(state.defaultModel).toBe("30000000-0000-4000-8000-000000000002");
});

test("reloading after connecting resumes at model enablement", async ({
  page,
}) => {
  await routeSetupApi(page);
  await page.goto("/e2e/provider-setup");
  await connectGeneric(page);
  await expect(modelsForm(page)).toBeVisible();
  await page.reload();
  await expect(modelsForm(page)).toBeVisible();
  await expect(modelsForm(page).getByLabel("alpha-chat")).not.toBeChecked();
  await modelsForm(page)
    .getByRole("button", { name: "Change provider" })
    .click();
  await expect(connectForm(page).getByLabel("Provider name")).toHaveValue(
    "Local models",
  );
});

test("skip for now goes to the new-chat page", async ({ page }) => {
  const state = await routeSetupApi(page);
  await page.goto("/e2e/provider-setup");
  await page.getByRole("link", { name: "Skip for now" }).click();
  await expect(page).toHaveURL(`${origin}/`);
  expect(state.saves).toEqual([]);
});

test.use({ hasTouch: true });
for (const scenario of authViewports) {
  test(`provider step controls are reachable at ${scenario.width}x${scenario.height}, ${(scenario.fontSize / 16) * 100}% text`, async ({
    page,
  }) => {
    await routeSetupApi(page, 1);
    await page.context().addCookies([
      {
        name: "asterism-font-size",
        value: `${scenario.fontSize}px`,
        url: origin,
      },
    ]);
    await page.setViewportSize(scenario);
    await page.goto("/e2e/provider-setup");
    const form = connectForm(page);
    await expect(form).toBeVisible();
    await expectAuthFits(page);
    const connectControls = [
      form.getByRole("radio", { name: "OpenAI", exact: true }),
      form.getByLabel("Provider name"),
      form.getByLabel("Base URL"),
      form.getByLabel("API key"),
      form.getByRole("button", { name: "Connect and discover models" }),
      form.getByRole("link", { name: "Skip for now" }),
    ];
    for (const control of connectControls) {
      await page.keyboard.press("Tab");
      await expect(control).toBeFocused();
      await expectReachable(control, true);
    }
    // Arrow keys move between provider types, as in any radio group.
    await connectControls[0].focus();
    // Radix moves focus after a task and selects only while the key is held.
    await page.keyboard.down("ArrowRight");
    await expect(
      form.getByRole("radio", { name: "OpenAI-compatible" }),
    ).toBeChecked();
    await page.keyboard.up("ArrowRight");
    await form.getByLabel("Provider name").fill("Local models");
    await form.getByLabel("Base URL").fill("http://localhost:11434/v1");
    await form.getByLabel("API key").fill("local-key");
    await form.getByLabel("API key").press("Enter");
    const alert = form.getByRole("alert");
    await expect(alert).toBeFocused();
    // At 200% text the summary can be taller than a short viewport; its start
    // is scrolled into view, as for the long login error.
    expect(
      await alert.evaluate((node) => node.getBoundingClientRect().top),
    ).toBeGreaterThanOrEqual(4);
    await expectAuthFits(page);
    await page.keyboard.press("Tab");
    await expect(
      form.getByRole("radio", { name: "OpenAI-compatible" }),
    ).toBeFocused();
    for (let index = 0; index < 4; index += 1) await page.keyboard.press("Tab");
    const retry = form.getByRole("button", { name: "Retry" });
    await expect(retry).toBeFocused();
    await expectReachable(retry, true);
    await page.keyboard.press("Enter");

    const models = modelsForm(page);
    await expect(models.getByLabel("alpha-chat")).toBeVisible();
    await expectAuthFits(page);
    await models.getByLabel("Search models").focus();
    const modelControls = [
      models.getByLabel("alpha-chat"),
      models.getByLabel("beta-vision"),
      models.getByLabel("gamma-tools"),
    ];
    for (const control of modelControls) {
      await page.keyboard.press("Tab");
      await expect(control).toBeFocused();
      await expectReachable(control, true);
    }
    await page.keyboard.press("Space");
    await expect(modelControls[2]).toBeChecked();
    for (const control of [
      models.getByLabel("Default model"),
      models.getByRole("button", { name: "Continue" }),
      models.getByRole("button", { name: "Change provider" }),
      models.getByRole("link", { name: "Skip for now" }),
    ]) {
      await page.keyboard.press("Tab");
      await expect(control).toBeFocused();
      await expectReachable(control, true);
    }
    await expectAuthFits(page);
    await models.getByRole("button", { name: "Continue" }).press("Enter");
    const start = page.getByRole("button", { name: "Start chatting" });
    await expect(start).toBeFocused();
    await expectReachable(start, true);
    // At 200% text on a 300px screen the message sits just above the focused
    // action and is reached by scrolling.
    await page.getByRole("status").scrollIntoViewIfNeeded();
    await expectReachable(page.getByRole("status"));
    await expectAuthFits(page);
  });
}

for (const theme of themes) {
  test(`${theme}: provider step steps, errors and models stay legible`, async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: "asterism-custom-theme-name", value: theme, url: origin },
    ]);
    await routeSetupApi(page, 1);
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto("/e2e/provider-setup");
    const steps = page.getByRole("list", { name: "First-run setup" });
    await steps
      .locator('[data-step-marker="complete"]')
      .evaluate((el) => el.setAttribute("data-contrast", "complete"));
    await steps
      .locator('[data-step-marker="current"]')
      .evaluate((el) => el.setAttribute("data-contrast", "current"));
    await steps
      .getByText("Connect a provider and enable a model.")
      .evaluate((el) => el.setAttribute("data-contrast", "detail"));
    await connectGeneric(page);
    await connectForm(page)
      .getByRole("alert")
      .evaluate((el) => el.setAttribute("data-contrast", "error"));
    expect(
      (await measure(page, "complete", "glyph")).ratio,
    ).toBeGreaterThanOrEqual(3);
    expect((await measure(page, "current")).ratio).toBeGreaterThanOrEqual(4.5);
    expect((await measure(page, "detail")).ratio).toBeGreaterThanOrEqual(4.5);
    expect((await measure(page, "error")).ratio).toBeGreaterThanOrEqual(4.5);
    await expectAuthFits(page);
    await connectForm(page).getByRole("button", { name: "Retry" }).click();
    const models = modelsForm(page);
    await models.getByLabel("beta-vision").check();
    await models
      .getByRole("list")
      .getByText("beta-vision")
      .evaluate((el) => el.setAttribute("data-contrast", "model"));
    expect((await measure(page, "model")).ratio).toBeGreaterThanOrEqual(4.5);
    await expectAuthFits(page);
    await models.getByRole("button", { name: "Continue" }).click();
    await page
      .getByRole("status")
      .evaluate((el) => el.setAttribute("data-contrast", "ready"));
    expect((await measure(page, "ready")).ratio).toBeGreaterThanOrEqual(4.5);
    await expect(steps.locator('[data-step-marker="complete"]')).toHaveCount(2);
    await expectAuthFits(page);
  });
}
