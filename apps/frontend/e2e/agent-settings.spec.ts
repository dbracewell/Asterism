import { expect, test } from "./support/test";
import type {
  MainAgentConfiguration,
  SubAgentDefinition,
} from "../src/lib/client";

const modelId = "11111111-1111-4111-8111-111111111111";
const workerId = "22222222-2222-4222-8222-222222222222";

test("persists singleton settings and manages fixed-model sub-agents", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let main: MainAgentConfiguration = {
    id: "44444444-4444-4444-8444-444444444444",
    name: "Main",
    description: "",
    system_prompt: "Original",
    tools: [],
    max_steps: 5,
  };
  let workers: SubAgentDefinition[] = [];
  await page.route("**/api/py/settings/user/main-agent", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      expect(body).not.toHaveProperty("model_id");
      main = { ...main, ...body };
    }
    await route.fulfill({ json: main });
  });
  await page.route("**/api/py/chat/models", (route) =>
    route.fulfill({
      json: [
        {
          id: modelId,
          name: "Worker model",
          provider_id: modelId,
          provider_name: "Test provider",
          provider_type: "generic_openai",
          available: true,
        },
      ],
    }),
  );
  await page.route("**/api/py/tools/active", (route) =>
    route.fulfill({
      json: {
        items: [
          { name: "web_fetch", policy: "user_configurable" },
          { name: "sub_agent", policy: "context_managed" },
          { name: "search_knowledge", policy: "context_managed" },
        ],
      },
    }),
  );
  await page.route("**/api/py/agents/sub-agents**", async (route) => {
    const method = route.request().method();
    if (method === "POST") {
      const body = route.request().postDataJSON();
      expect(body.model_id).toBe(modelId);
      const worker = { ...body, id: workerId, model_available: true };
      workers.push(worker);
      return route.fulfill({ status: 201, json: worker });
    }
    if (method === "PUT") {
      workers[0] = { ...workers[0], ...route.request().postDataJSON() };
      return route.fulfill({ json: workers[0] });
    }
    if (method === "DELETE") {
      const [deleted] = workers;
      workers = [];
      return route.fulfill({ json: deleted });
    }
    return route.fulfill({
      json: { items: workers, total: workers.length, page: 1, page_size: 10 },
    });
  });
  await page.goto("/e2e/agent-settings");
  await expect(
    page.getByRole("button", { name: "Edit main configuration" }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: /Delete main|default agent/i }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Edit main configuration" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Model", { exact: true })).toHaveCount(0);
  await dialog.getByLabel("Instructions").fill("Be precise");
  await dialog.getByLabel("Maximum steps").fill("0");
  await dialog.getByRole("button", { name: "Save configuration" }).click();
  await expect(dialog).toBeVisible();
  expect(main.system_prompt).toBe("Original");
  await dialog.getByLabel("Maximum steps").fill("7");
  await dialog.getByLabel("Top P", { exact: true }).fill("0.8");
  await expect(
    dialog.getByRole("checkbox", { name: "web_fetch" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("checkbox", { name: /sub_agent|search_knowledge/ }),
  ).toHaveCount(0);
  await dialog.getByLabel("web_fetch").check();
  await dialog.getByRole("button", { name: "Save configuration" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Edit main configuration" }).click();
  await expect(dialog.getByLabel("Instructions")).toHaveValue("Be precise");
  await expect(dialog.getByLabel("Top P", { exact: true })).toHaveValue("0.8");
  await expect(dialog.getByLabel("web_fetch")).toBeChecked();
  await dialog.getByRole("button", { name: "Close" }).click();
  await page
    .getByRole("button", { name: "Create sub-agent", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Save configuration" }),
  ).toBeDisabled();
  await dialog.getByLabel("Name", { exact: true }).fill("Researcher");
  await dialog.getByLabel("Model", { exact: true }).click();
  await page.getByRole("option", { name: "Worker model", exact: true }).click();
  await dialog.getByLabel("Instructions").fill("Research carefully");
  await dialog.getByRole("button", { name: "Save configuration" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByText("Worker model (Test provider)", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit Researcher" }).click();
  await expect(dialog.getByLabel("Model", { exact: true })).toHaveText(
    "Worker model",
  );
  await dialog.getByLabel("Name", { exact: true }).fill("Analyst");
  await dialog.getByRole("button", { name: "Save configuration" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Edit Analyst" }),
  ).toBeVisible();
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, {
    timeout: 10_000,
  });
  await page.screenshot({
    path: "test-results/agent-settings-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/agent-settings-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Edit main configuration" }).click();
  await expect(dialog.getByLabel("Instructions")).toHaveValue("Be precise");
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/agent-settings-form-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Delete Analyst" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("all projects");
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Confirm" })
    .click();
  await expect(page.getByText(/No sub-agents yet/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("browses pages and recovers query failures while retaining an unavailable binding", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/api/py/settings/user/main-agent", (route) =>
    route.fulfill({
      json: {
        id: "44444444-4444-4444-8444-444444444444",
        name: "Main",
        description: "",
      },
    }),
  );
  await page.route("**/api/py/chat/models", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/py/tools/active", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/py/agents/sub-agents**", (route) => {
    if (fail) return route.fulfill({ status: 403, json: { detail: "Denied" } });
    const second =
      new URL(route.request().url()).searchParams.get("page") === "2";
    return route.fulfill({
      json: {
        items: [
          {
            id: workerId,
            name: second ? "Last worker" : "Unavailable worker",
            model_id: modelId,
            model_available: false,
          },
        ],
        total: 11,
        page: second ? 2 : 1,
        page_size: 10,
      },
    });
  });
  await page.goto("/e2e/agent-settings");
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Could not load sub-agents",
  );
  await expect(
    page.getByRole("button", { name: "Next", exact: true }),
  ).toHaveCount(0);
  fail = false;
  await page
    .getByRole("region", { name: "Sub-agents", exact: true })
    .getByRole("button", { name: "Retry", exact: true })
    .click();
  await expect(page.getByText(modelId, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit Last worker" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await page.getByRole("button", { name: "Edit Unavailable worker" }).click();
  await expect(page.getByLabel("Model", { exact: true })).toHaveText(
    modelId + " (unavailable)",
  );
  await expect(
    page.getByRole("button", { name: "Save configuration" }),
  ).toBeDisabled();
  await expect(page.getByRole("dialog")).toContainText("No available models");
});

for (const viewport of [
  { width: 1280, height: 720, enlarged: false },
  { width: 320, height: 300, enlarged: false },
  { width: 390, height: 600, enlarged: true },
]) {
  test(`model popup stays clickable and keyboard accessible inside a dialog at ${viewport.width}x${viewport.height}${viewport.enlarged ? " with 200% text" : ""}`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize(viewport);
    await page.route("**/api/py/settings/user/main-agent", (route) =>
      route.fulfill({ json: { id: workerId, name: "Main", description: "" } }),
    );
    await page.route("**/api/py/agents/sub-agents**", (route) =>
      route.fulfill({ json: { items: [], total: 0, page: 1, page_size: 10 } }),
    );
    await page.route("**/api/py/tools/active", (route) =>
      route.fulfill({ json: { items: [] } }),
    );
    await page.route("**/api/py/chat/models", (route) =>
      route.fulfill({
        json: Array.from({ length: 24 }, (_, i) => ({
          id: `33333333-3333-4333-8333-${String(i + 1).padStart(12, "0")}`,
          name: `Worker ${i + 1}`,
          provider_id: modelId,
          provider_name: "Test provider",
          provider_type: "generic_openai",
          available: true,
        })),
      }),
    );
    await page.goto("/e2e/agent-settings");
    if (viewport.enlarged) {
      await page.addStyleTag({
        content: "html { font-size: 200% !important; }",
      });
    }
    await page
      .getByRole("button", { name: "Create sub-agent", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Create sub-agent",
      exact: true,
    });
    await dialog.getByLabel("Name", { exact: true }).fill("Popup verification");
    const model = dialog.getByRole("combobox", { name: "Model", exact: true });
    await expect(
      dialog.getByRole("button", { name: "Save configuration" }),
    ).toBeDisabled();
    await model.click();
    const search = dialog.getByRole("combobox", {
      name: "Search models…",
      exact: true,
    });
    await expect(search).toBeFocused();
    await search.fill("Worker 24");
    const option = dialog.getByRole("option", {
      name: "Worker 24",
      exact: true,
    });
    // Fully visible, up to sub-pixel rounding of the popup's floating position
    // (0.98 of the 28px row tolerates about half a pixel).
    await expect(option).toBeInViewport({ ratio: 0.98 });
    // A normal click exercises stacking, clipping and the modal pointer boundary.
    await option.click();
    await expect(model).toHaveText("Worker 24");
    await expect(model).toBeFocused();
    await expect(
      dialog.getByRole("button", { name: "Save configuration" }),
    ).toBeEnabled();
    await page.keyboard.press("Enter");
    await expect(search).toBeFocused();
    await search.fill("Worker 23");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(model).toHaveText("Worker 23");
    await expect(model).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(search).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await expect(model).toBeFocused();
    await page.screenshot({ path: info.outputPath("model-dialog.png") });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Create sub-agent", exact: true }),
    ).toBeFocused();
    expect(errors).toEqual([]);
  });
}
