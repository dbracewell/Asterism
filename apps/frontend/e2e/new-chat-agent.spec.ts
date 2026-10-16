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
  await page.goto("/e2e/new-chat-agent");
  await expect(
    page.getByRole("button", { name: "Edit main configuration" }),
  ).toHaveCount(1);
  await expect(page.getByRole("button", { name: /default/i })).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Sub-agents" }).getByRole("alert"),
  ).toContainText("Fixed model unavailable");
  await page.getByRole("button", { name: "Edit main configuration" }).click();
  await expect(page.getByLabel("Fixed model")).toHaveCount(0);
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
  await expect(page.getByLabel("Fixed model")).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText(/knowledge bases/i),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save configuration" }),
  ).toBeDisabled();
  await page.getByLabel("Fixed model").click();
  await page.getByRole("option", { name: "Available model (Test)" }).click();
  await expect(
    page.getByRole("button", { name: "Save configuration" }),
  ).toBeEnabled();
});
