import { expect, test } from "@playwright/test";
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
    id: "main",
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
          provider_name: "Test provider",
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
  await expect(dialog.getByLabel("Fixed model")).toHaveCount(0);
  await dialog.getByLabel("Instructions").fill("Be precise");
  await dialog.getByLabel("Maximum steps").fill("0");
  await dialog.getByRole("button", { name: "Save configuration" }).click();
  await expect(dialog).toBeVisible();
  expect(main.system_prompt).toBe("Original");
  await dialog.getByLabel("Maximum steps").fill("7");
  await dialog.getByLabel("Top P (optional)").fill("0.8");
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
  await expect(dialog.getByLabel("Top P (optional)")).toHaveValue("0.8");
  await expect(dialog.getByLabel("web_fetch")).toBeChecked();
  await dialog.getByRole("button", { name: "Close" }).click();
  await page
    .getByRole("button", { name: "Create sub-agent", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Save configuration" }),
  ).toBeDisabled();
  await dialog.getByLabel("Name", { exact: true }).fill("Researcher");
  await dialog.getByLabel("Fixed model").click();
  await page
    .getByRole("option", { name: "Worker model (Test provider)" })
    .click();
  await dialog.getByLabel("Instructions").fill("Research carefully");
  await dialog.getByRole("button", { name: "Save configuration" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByText("Fixed model: Worker model (Test provider)"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit Researcher" }).click();
  await expect(dialog.getByLabel("Fixed model")).toHaveText(
    "Worker model (Test provider)",
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
    route.fulfill({ json: { id: "main", name: "Main", description: "" } }),
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
  ).toBeDisabled();
  fail = false;
  await page.getByRole("button", { name: "Retry sub-agents" }).click();
  await expect(page.getByText("Fixed model: " + modelId)).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit Last worker" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await page.getByRole("button", { name: "Edit Unavailable worker" }).click();
  await expect(page.getByLabel("Fixed model")).toHaveText(
    modelId + " (unavailable)",
  );
  await expect(
    page.getByRole("button", { name: "Save configuration" }),
  ).toBeDisabled();
  await expect(page.getByRole("dialog")).toContainText("No available models");
});
