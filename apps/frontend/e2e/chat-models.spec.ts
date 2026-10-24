import { expect, test } from "./support/test";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const provider_id = "33333333-3333-4333-8333-333333333333";
const choices = [
  {
    id: A,
    name: "Alpha",
    provider_id,
    provider_name: "Provider",
    available: true,
    supports_vision: false,
    context_window: 4096,
  },
  {
    id: B,
    name: "Beta",
    provider_id,
    provider_name: "Provider",
    available: true,
    supports_vision: true,
    context_window: 8192,
  },
];
test("switches the selected model independently of historical provenance and disables changes during a run", async ({
  page,
}) => {
  await page.route("**/api/py/chat/models", (route) =>
    route.fulfill({ json: choices }),
  );
  const changes: unknown[] = [];
  await page.route("**/api/py/chat/*/model", (route) => {
    changes.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        id: "77777777-7777-4777-8777-777777777777",
        user_id: "test",
        created_at: 0,
        updated_at: 0,
        selected_model_id: B,
        selected_model: choices[1],
        model_revision: 2,
      },
    });
  });
  await page.goto("/e2e/chat-models");
  await page.getByLabel("Chat model").click();
  await page.getByRole("option", { name: "Beta (Provider)" }).click();
  await expect(page.getByLabel("Chat model")).toContainText("Beta");
  await expect(
    page.getByRole("status").filter({ hasText: "Selection revision" }),
  ).toHaveText("Selection revision: 2");
  expect(changes).toEqual([{ model_id: B, expected_model_revision: 1 }]);
  await expect(page.getByLabel("Executed model")).toHaveText(
    "Alpha · Provider · configuration 1",
  );
  await page.getByRole("button", { name: "Simulate active run" }).click();
  await expect(page.getByLabel("Chat model")).toBeDisabled();
  await page.getByRole("button", { name: "End simulated run" }).click();
  await expect(page.getByLabel("Chat model")).toBeEnabled();
});

test("reports loading failures with retry and retains an unavailable selection without replacement", async ({
  page,
}) => {
  let failed = true;
  await page.route("**/api/py/chat/models", (route) =>
    failed
      ? route.fulfill({ status: 503, json: { detail: "offline" } })
      : route.fulfill({
          json: [{ ...choices[0], available: false }, choices[1]],
        }),
  );
  await page.goto("/e2e/chat-models");
  const alert = page
    .getByRole("alert")
    .filter({ hasText: "Could not load models" });
  await expect(alert).toBeVisible();
  await expect(page.getByLabel("Chat model")).toBeDisabled();
  failed = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Selected model is unavailable" }),
  ).toBeVisible();
  await expect(page.getByLabel("Chat model")).toContainText("Alpha");
  await expect(page.getByLabel("Executed model")).toContainText("Alpha");
});
