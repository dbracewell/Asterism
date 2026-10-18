import { expect, test } from "@playwright/test";

test("edits the sole model-free main configuration and exposes unavailable worker bindings", async ({
  page,
}) => {
  await page.route("**/api/py/tools/active", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            name: "sub_agent",
            policy: "context_managed",
            description: "Delegation",
          },
          {
            name: "search_knowledge",
            policy: "context_managed",
            description: "Retrieval",
          },
          {
            name: "web_fetch",
            policy: "user_configurable",
            description: "Fetch",
          },
        ],
      },
    }),
  );
  let saved: unknown;
  await page.route("**/api/py/settings/user/main-agent", (route) => {
    if (route.request().method() === "PUT")
      saved = route.request().postDataJSON();
    return route.fulfill({
      json: {
        ...(saved as object),
        id: "11111111-1111-4111-8111-111111111111",
        name: "Main agent",
        description: "",
      },
    });
  });
  await page.route("**/api/py/agents/sub-agents?**", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "44444444-4444-4444-8444-444444444444",
            name: "Research worker",
            model_id: "55555555-5555-4555-8555-555555555555",
            model_available: false,
            max_steps: 5,
            tools: [],
          },
        ],
        total: 1,
        page: 1,
        page_size: 10,
      },
    }),
  );
  await page.route("**/api/py/chat/models", (route) =>
    route.fulfill({
      json: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          name: "Available model",
          provider_name: "Test",
          available: true,
        },
      ],
    }),
  );
  await page.goto("/e2e/new-chat-agent");
  await expect(
    page.getByRole("button", { name: "Edit main configuration" }),
  ).toHaveCount(1);
  await expect(page.getByRole("button", { name: /default/i })).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Sub-agents" }).getByRole("status"),
  ).toContainText("Fixed model unavailable");
  await page.getByRole("button", { name: "Edit main configuration" }).click();
  await expect(page.getByLabel("Model", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("dialog").getByText(/knowledge bases/i),
  ).toHaveCount(0);
  await expect(page.getByText("web_fetch", { exact: true })).toBeVisible();
  await expect(page.getByText("sub_agent", { exact: true })).toHaveCount(0);
  await expect(page.getByText("search_knowledge", { exact: true })).toHaveCount(
    0,
  );
  await page
    .getByLabel("Instructions", { exact: true })
    .fill("Explain carefully");
  await page.getByRole("button", { name: "Save configuration" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(saved).toMatchObject({
    system_prompt: "Explain carefully",
    max_steps: 5,
  });
  expect(saved).not.toHaveProperty("model_id");
  expect(saved).toMatchObject({ tools: [] });
  await page.getByRole("button", { name: "Edit Research worker" }).click();
  await expect(page.getByLabel("Model", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText(/knowledge bases/i),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save configuration" }),
  ).toBeDisabled();
  await expect(page.getByLabel("Model", { exact: true })).toContainText(
    "55555555-5555-4555-8555-555555555555 (unavailable)",
  );
  await page.getByLabel("Model", { exact: true }).click();
  await page
    .getByRole("button", { name: "Available model", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save configuration" }),
  ).toBeEnabled();
});
