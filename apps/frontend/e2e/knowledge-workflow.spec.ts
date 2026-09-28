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

test("curates a library file without making a second processed copy", async ({
  page,
}) => {
  let memberships: Array<{ id: string; file_id: string; position: number }> = [
    {
      id: "30000000-0000-4000-8000-000000000002",
      file_id: reportFile.id,
      position: 0,
    },
  ];
  await page.route(
    `**/api/py/knowledge-bases/${base.id}/files**`,
    async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          json: {
            files: memberships,
            total: memberships.length,
            page: 1,
            page_size: 100,
          },
        });
        return;
      }
      if (route.request().method() === "POST") {
        const membership = {
          id: "30000000-0000-4000-8000-000000000001",
          file_id: imageFile.id,
          position: memberships.length,
        };
        memberships = [...memberships, membership];
        await route.fulfill({ status: 201, json: membership });
        return;
      }
      if (route.request().method() === "PUT") {
        const { membership_ids: membershipIds } = route
          .request()
          .postDataJSON();
        memberships = membershipIds.map((id: string, position: number) => ({
          ...memberships.find((membership) => membership.id === id)!,
          position,
        }));
        await route.fulfill({
          json: {
            files: memberships,
            total: memberships.length,
            page: 1,
            page_size: 100,
          },
        });
        return;
      }
      const membershipId = route.request().url().split("/").pop();
      const removed = memberships.find(
        (membership) => membership.id === membershipId,
      )!;
      memberships = memberships.filter(
        (membership) => membership.id !== membershipId,
      );
      await route.fulfill({ json: removed });
    },
  );
  await page.route("**/api/py/files?**", (route) =>
    route.fulfill({
      json: {
        files: [imageFile, reportFile],
        total: 2,
        page: 1,
        page_size: 100,
      },
    }),
  );

  await page.goto("/e2e/knowledge-captions");
  await page.getByLabel("Uploaded file").selectOption(imageFile.id);
  await page.getByRole("button", { name: "Add existing file" }).click();
  await expect(page.getByText("diagram.png")).toBeVisible();
  await expect(
    page.getByText("Manage processing, captions, and deletion in Files."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Move diagram.png up" }).click();
  await expect(
    page.getByRole("button", { name: "Move diagram.png up" }),
  ).toBeDisabled();
  await page
    .getByRole("article")
    .filter({ hasText: "diagram.png" })
    .getByRole("button", { name: "Remove from collection" })
    .click();
  await expect(page.getByText("report.pdf")).toBeVisible();
});
