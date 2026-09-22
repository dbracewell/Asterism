import { expect, test } from "@playwright/test";

const base = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Research",
  description: "Private notes",
  created_at: 0,
  updated_at: 0,
};

test("manages a knowledge base through the generated API client", async ({ page }) => {
  await page.route("**/api/py/knowledge-bases/**", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({ json: { knowledge_bases: [base], total: 1, page: 1, page_size: 100 } });
    } else if (method === "POST") {
      await route.fulfill({ status: 201, json: { ...base, name: "Manual" } });
    } else {
      await route.fulfill({ json: base });
    }
  });

  await page.goto("/e2e/knowledge");
  await expect(page.getByRole("link", { name: "Research" })).toHaveAttribute("href", `/knowledge/${base.id}`);
  await page.getByLabel("Name").fill("Manual");
  await page.getByRole("button", { name: "Create knowledge base" }).click();
  await expect(page.getByLabel("Name")).toHaveValue("");

  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name").fill("Updated research");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("link", { name: "Research" })).toBeVisible();
});
