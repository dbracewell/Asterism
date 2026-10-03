import { expect, test } from "@playwright/test";

const imageFile = {
  id: "20000000-0000-4000-8000-000000000001",
  filename: "diagram.png",
  original_name: "diagram.png",
  size: 12,
  mime_type: "image/png",
  kind: "image",
  content_status: "ready",
  content_error: null,
  thumbnail: null,
  created_at: 0,
  updated_at: 0,
};

const artifact = {
  id: "40000000-0000-4000-8000-000000000001",
  file_id: imageFile.id,
  generation: 1,
  processing_profile_generation: 1,
  processing_profile_identity: "default",
  contract_version: 1,
  status: "ready",
  is_current: true,
  chunk_count: 1,
  text_embeddings_ready: true,
  visual_embedding_ready: true,
  caption: {
    status: "accepted",
    source: "provider",
    model: "caption-model",
    text: "A diagram",
    error_code: null,
    error_reason: null,
    generated_at: 0,
    accepted_at: 0,
  },
  error_code: null,
  error_reason: null,
  started_at: 0,
  completed_at: 0,
  created_at: 0,
  updated_at: 0,
};

test("shows canonical processing state and confirms the full impact before file deletion", async ({
  page,
}) => {
  let deleted = false;
  await page.route("**/api/py/files**", async (route) => {
    const request = route.request();
    const method = request.method();
    const url = request.url();
    if (url.includes("/knowledge/caption") && method === "PUT") {
      await route.fulfill({ json: artifact });
      return;
    }
    if (url.includes("/knowledge")) {
      await route.fulfill({ json: artifact });
      return;
    }
    if (method === "DELETE") {
      deleted = true;
      await route.fulfill({ json: { files: [] } });
      return;
    }
    await route.fulfill({
      json: {
        files: deleted ? [] : [imageFile],
        total: deleted ? 0 : 1,
        page: 1,
        page_size: 50,
      },
    });
  });

  await page.goto("/e2e/file-manager");
  const diagram = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "diagram.png" });
  await expect(diagram).toBeVisible();
  await expect(page.getByText("Knowledge: ready")).toBeVisible();
  await page.getByRole("button", { name: "Edit caption", exact: true }).click();
  await expect(
    page.getByText(
      "Caption regeneration may send the image to the configured external provider.",
    ),
  ).toBeVisible();
  await page.getByLabel("Caption text").fill("An edited diagram");
  await page.getByRole("button", { name: "Save caption" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await diagram.click();
  await page.getByRole("button", { name: "Delete selected files" }).click();
  await expect(page.getByText("Delete selected files?")).toBeVisible();
  await expect(
    page.getByText(
      "This permanently removes the selected files, every knowledge-base membership, and all derived extractions, captions, and vectors.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("No files found.")).toBeVisible();
});
