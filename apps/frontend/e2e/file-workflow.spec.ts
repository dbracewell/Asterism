import { expect, test } from "@playwright/test";

const uploaded = {
  id: "10000000-0000-4000-8000-000000000001",
  filename: "report.pdf",
  original_name: "report.pdf",
  size: 12,
  mime_type: "application/pdf",
  kind: "document",
  content_status: "pending",
  content_error: null,
  created_at: 0,
  updated_at: 0,
};

test("uploads, attaches, and renders a persisted file with a mocked reply", async ({ page }) => {
  await page.route("**/api/py/files/**", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 200, json: { files: [uploaded] } });
      return;
    }
    await route.continue();
  });
  await page.goto("/e2e/files");
  await page.getByLabel("Choose attachments").setInputFiles({
    name: "report.pdf", mimeType: "application/pdf", buffer: Buffer.from("pdf"),
  });
  await page.getByRole("textbox", { name: "Message" }).fill("Summarize this");
  await page.getByLabel("Send message").click();
  await expect(page.getByLabel("Persisted user message")).toContainText("report.pdf");
  await expect(page.getByLabel("Assistant reply")).toHaveText("Mocked assistant reply: Summarize this");
});

test("keeps a failed upload visible and does not send the message", async ({ page }) => {
  await page.route("**/api/py/files/**", (route) => route.fulfill({ status: 413, json: { detail: "File exceeds upload limit" } }));
  await page.goto("/e2e/files");
  await page.getByLabel("Choose attachments").setInputFiles({ name: "large.pdf", mimeType: "application/pdf", buffer: Buffer.from("pdf") });
  await page.getByLabel("Send message").click();
  await expect(page.getByText("large.pdf: File exceeds upload limit")).toBeVisible();
  await expect(page.getByText("Failed")).toBeVisible();
  await expect(page.getByLabel("Assistant reply")).toHaveCount(0);
});
