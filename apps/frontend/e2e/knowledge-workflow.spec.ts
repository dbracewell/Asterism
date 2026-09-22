import { expect, test } from "@playwright/test";

const base = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Research",
  description: "Private notes",
  created_at: 0,
  updated_at: 0,
};

const imageDocument = {
  id: "20000000-0000-4000-8000-000000000001",
  original_name: "diagram.png",
  mime_type: "image/png",
  revision: 1,
  position: 0,
  status: "ready",
  error: null,
  indexed_at: null,
  replaces_document_id: null,
  metadata: {},
  created_at: 0,
  updated_at: 0,
  caption: { status: "draft", source: "local", model: "smolvlm2", text: "A draft diagram", error_code: null, error_reason: null, generated_at: 0, accepted_at: null },
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

test("reviews an image caption without exposing its provider request", async ({ page }) => {
  await page.route(`**/api/py/knowledge-bases/${base.id}/documents**`, async (route) => {
    const url = route.request().url();
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { documents: [imageDocument], total: 1, page: 1, page_size: 100 } });
    } else if (url.endsWith("/caption")) {
      await route.fulfill({ json: { ...imageDocument, caption: { ...imageDocument.caption, status: "accepted", text: "Reviewed diagram" } } });
    } else if (url.endsWith("/generate")) {
      await route.fulfill({ status: 202, json: { ...imageDocument, caption: { ...imageDocument.caption, status: "pending" } } });
    } else {
      await route.fulfill({ json: imageDocument });
    }
  });
  await page.route("**/api/py/files/**", (route) => route.fulfill({ json: { files: [], total: 0, page: 1, page_size: 100 } }));

  await page.goto("/e2e/knowledge-captions");
  await expect(page.getByRole("region", { name: "Caption for diagram.png" })).toBeVisible();
  await page.getByLabel("Edit caption for diagram.png").fill("Reviewed diagram");
  await page.getByRole("button", { name: "Accept caption" }).click();
  await expect(page.getByRole("button", { name: "Regenerate caption" })).toBeVisible();
  await page.getByRole("button", { name: "Clear caption" }).click();
});
