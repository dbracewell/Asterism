import { expect, test } from "@playwright/test";

const base = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Research",
  description: "Private notes",
  created_at: 0,
  updated_at: 0,
};

const imageFile = {
  id: "20000000-0000-4000-8000-000000000001",
  filename: "diagram.png",
  original_name: "diagram.png",
  size: 12,
  mime_type: "image/png",
  kind: "image",
  content_status: "ready",
  content_error: null,
  created_at: 0,
  updated_at: 0,
};

const reportFile = {
  ...imageFile,
  id: "20000000-0000-4000-8000-000000000002",
  filename: "report.pdf",
  original_name: "report.pdf",
  mime_type: "application/pdf",
  kind: "document",
};

test("lists knowledge bases through the generated API client", async ({
  page,
}) => {
  await page.route(/\/api\/py\/knowledge-bases\/?(?:\?.*)?$/, async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({
        json: { knowledge_bases: [base], total: 1, page: 1, page_size: 100 },
      });
    } else if (method === "POST") {
      await route.fulfill({ status: 201, json: { ...base, name: "Manual" } });
    }
  });
  await page.route(new RegExp(`/api/py/knowledge-bases/${base.id}$`), (route) =>
    route.fulfill({ json: base }),
  );

  await page.goto("/e2e/knowledge");
  await expect(page.getByRole("link", { name: "Research" })).toHaveAttribute(
    "href",
    `/knowledge/${base.id}`,
  );
});

test("manages knowledge-base membership in the file explorer without deleting library files", async ({
  page,
}) => {
  let memberIds = [reportFile.id];
  const library = [imageFile, reportFile];
  const artifact = {
    status: "ready",
    caption: { status: null, text: null },
  };
  await page.route(
    `**/api/py/knowledge-bases/${base.id}/files**`,
    async (route) => {
      const method = route.request().method();
      if (method === "POST") {
        const { file_id: fileId } = route.request().postDataJSON();
        memberIds = [...memberIds, fileId];
        await route.fulfill({ status: 201, json: { id: fileId } });
        return;
      }
      if (method === "DELETE") {
        const { file_ids: fileIds } = route.request().postDataJSON();
        memberIds = memberIds.filter((id) => !fileIds.includes(id));
        await route.fulfill({
          json: { files: [], total: 0, page: 1, page_size: 1 },
        });
        return;
      }
      await route.fulfill({
        json: { files: [], total: 0, page: 1, page_size: 100 },
      });
    },
  );
  await page.route(/\/api\/py\/files\/info\/.*/, (route) =>
    route.fulfill({ json: imageFile }),
  );
  await page.route(/\/api\/py\/files\/[^/?]+\/knowledge$/, (route) =>
    route.fulfill({ json: artifact }),
  );
  await page.route(/\/api\/py\/files\/?(?:\?.*)?$/, (route) => {
    const inBase = new URL(route.request().url()).searchParams.has(
      "knowledge_base_id",
    );
    const files = inBase
      ? library.filter((file) => memberIds.includes(file.id))
      : library;
    return route.fulfill({
      json: { files, total: files.length, page: 1, page_size: 100 },
    });
  });

  await page.goto("/e2e/knowledge-captions");
  await page.getByLabel("Uploaded file").selectOption(imageFile.id);
  await page.getByRole("button", { name: "Add existing file" }).click();
  const explorer = page;
  await expect(
    explorer.getByRole("button", { name: /diagram\.png/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Delete selected files" }),
  ).toHaveCount(0);

  await explorer.getByRole("button", { name: /diagram\.png/ }).click();
  await page
    .getByRole("button", { name: "Remove selected files from knowledge base" })
    .click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(
    explorer.getByRole("button", { name: /diagram\.png/ }),
  ).toHaveCount(0);
  await expect(
    explorer.getByRole("button", { name: /report\.pdf/ }),
  ).toBeVisible();
});
