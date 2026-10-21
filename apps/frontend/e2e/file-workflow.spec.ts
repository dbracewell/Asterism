import { expect, test } from "@playwright/test";

const uploaded = {
  id: "10000000-0000-4000-8000-000000000001",
  filename: "report.pdf",
  original_name: "report.pdf",
  size: 1000,
  mime_type: "application/pdf",
  kind: "document",
  content_status: "pending",
  content_error: null,
  created_at: 0,
  updated_at: 0,
};

const acceptedMessage = {
  id: "30000000-0000-4000-8000-000000000001",
  role: "user",
  content: "Summarize this",
  created_at: 1,
  status: "pending",
  files: [
    {
      file_id: uploaded.id,
      filename: "report.pdf",
      name: "report.pdf",
      mime_type: "application/pdf",
      size: 1000,
      kind: "document",
      status: "ready",
      available: true,
    },
  ],
};
const messagePath =
  "**/api/py/chat/22222222-2222-4222-8222-222222222222/message";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/py/chat/drafts/*", (route) =>
    route.fulfill({
      json: {
        id: "44444444-4444-4444-8444-444444444444",
        file_ids: [uploaded.id],
        unavailable_file_ids: [],
      },
    }),
  );
  await page.route("**/api/py/chat/drafts", (route) =>
    route.fulfill({
      json: {
        id: "44444444-4444-4444-8444-444444444444",
        chat_id: null,
        file_ids: [],
        unavailable_file_ids: [],
        expires_at: 9999999999,
      },
    }),
  );
  await page.route("**/api/py/files/*/knowledge", (route) =>
    route.fulfill({ json: { status: "ready", extractions: {} } }),
  );
});

test("uploads, attaches, and renders a persisted file with a mocked reply", async ({
  page,
}) => {
  await page.route("**/api/py/chat/drafts/*/uploads", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 200, json: { files: [uploaded] } });
      return;
    }
    await route.continue();
  });
  await page.route(messagePath, (route) =>
    route.fulfill({ json: acceptedMessage }),
  );
  const sourcePath = `**/api/py/chat/22222222-2222-4222-8222-222222222222/files/${uploaded.id}`;
  await page.route(sourcePath, (route) =>
    route.fulfill({
      status: 200,
      body: "original pdf bytes",
      contentType: "application/pdf",
    }),
  );
  await page.goto("/e2e/files");
  await page.getByLabel("Choose attachments").setInputFiles({
    name: "report.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("pdf"),
  });
  await page.getByRole("textbox", { name: "Message" }).fill("Summarize this");
  await expect(page.getByLabel("Send message")).toBeEnabled();
  await page.getByLabel("Send message").click();
  await expect(page.getByLabel("Persisted user message")).toContainText(
    "report.pdf",
  );
  await expect(page.getByLabel("Assistant reply")).toHaveText(
    "Mocked assistant reply: Summarize this",
  );
  const download = page.waitForEvent("download");
  const request = page.waitForRequest((request) =>
    request.url().includes(`/files/${uploaded.id}`),
  );
  await page.getByRole("link", { name: "Download report.pdf" }).click();
  expect((await request).url()).toContain(
    `/chat/22222222-2222-4222-8222-222222222222/files/${uploaded.id}`,
  );
  expect((await download).suggestedFilename()).toBe("report.pdf");
});

test("keeps a failed upload visible and does not send the message", async ({
  page,
}) => {
  await page.route("**/api/py/chat/drafts/*/uploads", (route) =>
    route.fulfill({
      status: 413,
      json: { detail: "File exceeds upload limit" },
    }),
  );
  await page.goto("/e2e/files");
  await page.getByLabel("Choose attachments").setInputFiles({
    name: "large.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("pdf"),
  });
  await page.getByRole("textbox", { name: "Message" }).fill("Summarize this");
  await expect(page.getByLabel("Send message")).toBeEnabled();
  await page.getByLabel("Send message").click();
  await expect(
    page.getByText("large.pdf: File exceeds upload limit"),
  ).toBeVisible();
  await expect(page.getByText("Failed", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Send message")).toBeEnabled();
  await expect(page.getByLabel("Assistant reply")).toHaveCount(0);
});

test("retries a failed send with the same receipt key and no duplicate upload", async ({
  page,
}) => {
  let uploads = 0;
  const sends: Array<{ request_id: string; files: string[] }> = [];
  await page.route("**/api/py/chat/drafts/*/uploads", (route) => {
    uploads += 1;
    return route.fulfill({ json: { files: [uploaded] } });
  });
  await page.route(messagePath, (route) => {
    sends.push(route.request().postDataJSON());
    return sends.length === 1
      ? route.fulfill({ status: 503, json: { detail: "Send unavailable" } })
      : route.fulfill({ json: acceptedMessage });
  });
  await page.goto("/e2e/files");
  await page.getByLabel("Choose attachments").setInputFiles({
    name: "report.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("pdf"),
  });
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Summarize this");
  await page.getByLabel("Send message").click();
  await expect(page.locator("form").getByRole("alert")).toHaveText(
    "Send unavailable",
  );
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toHaveValue("Summarize this");
  await expect(page.getByLabel("Persisted user message")).toHaveCount(0);
  await page.getByLabel("Send message").click();
  await expect(page.getByLabel("Persisted user message")).toContainText(
    "report.pdf",
  );
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toHaveValue("");
  expect(uploads).toBe(1);
  expect(sends).toHaveLength(2);
  expect(sends[1]).toEqual(sends[0]);
});
