import { knowledgeArtifact } from "./support/knowledge-artifact";
import { expect, test } from "./support/test";
const P = "11111111-1111-4111-8111-111111111111";
const project = {
  id: P,
  name: "Research",
  description: "Shared references",
  system_prompt: "",
  context_revision: 3,
  created_at: 1,
  updated_at: 1,
};
const fileIds: Record<string, string> = {
  shared: "20000000-0000-4000-8000-000000000001",
  new: "20000000-0000-4000-8000-000000000002",
  uploaded: "20000000-0000-4000-8000-000000000003",
};
const source = (name: string, member = false) => ({
  id: fileIds[name],
  filename: `${name}.txt`,
  original_name: `${name}.txt`,
  size: 10,
  mime_type: "text/plain",
  kind: "text",
  content_status: "ready",
  content_error: null,
  created_at: 0,
  updated_at: 0,
  thumbnail: null,
  projects: member
    ? [
        { ...project },
        {
          id: "30000000-0000-4000-8000-000000000001",
          name: "Other project",
          context_revision: 1,
        },
      ]
    : [],
});

test("shares explorer controls for project membership, library picking, upload, filtering and removal", async ({
  page,
}) => {
  let revision = 3;
  let members = [source("shared", true)];
  const writes: Array<{
    method: string;
    body: { file_ids: string[]; expected_context_revision: number };
  }> = [];
  let libraryDeletes = 0;
  let regenerations = 0;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(/\/api\/py\/chat\//, (route) =>
    route.fulfill({ json: { chats: [], total: 0 } }),
  );
  await page.route(/\/api\/py\/projects\/?(?:\?.*)?$/, (route) =>
    route.fulfill({ json: { projects: [project], total: 1 } }),
  );
  await page.route(`**/api/py/projects/${P}`, (route) =>
    route.fulfill({ json: { ...project, context_revision: revision } }),
  );
  await page.route(new RegExp(`/api/py/projects/${P}/files`), async (route) => {
    const method = route.request().method();
    if (method !== "GET") {
      const body = route.request().postDataJSON();
      writes.push({ method, body });
      expect(body.expected_context_revision).toBe(revision);
      if (method === "POST")
        members.push(
          source(
            Object.keys(fileIds).find(
              (name) => fileIds[name] === body.file_ids[0],
            )!,
            true,
          ),
        );
      else members = members.filter((file) => !body.file_ids.includes(file.id));
      revision++;
      return route.fulfill({
        json: {
          context_revision: revision,
          changed_file_ids: body.file_ids,
          unchanged_file_ids: [],
        },
      });
    }
    const query = new URL(route.request().url()).searchParams.get("query");
    const files = members.filter(
      (file) => !query || file.filename.includes(query),
    );
    return route.fulfill({
      json: { files, total: files.length, page: 1, page_size: 50 },
    });
  });
  await page.route(/\/api\/py\/files\//, (route) => {
    if (route.request().url().includes("/knowledge")) {
      if (route.request().method() === "POST") regenerations++;
      return route.fulfill({
        json: knowledgeArtifact(
          fileIds[
            new URL(route.request().url()).pathname
              .split("/")
              .at(-2)!
              .replace(".txt", "")
          ],
          {
            status: "failed",
            extractions: {
              embedding: { kind: "embedding", status: "failed" },
            },
          },
        ),
      });
    }
    if (route.request().method() === "DELETE") libraryDeletes++;
    const files =
      route.request().method() === "POST"
        ? [source("uploaded")]
        : [source("shared", true), source("new")];
    return route.fulfill({
      json: { files, total: files.length, page: 1, page_size: 50 },
    });
  });
  await page.goto("/e2e/projects?view=overview");
  const explorer = page.getByRole("region", {
    name: "Project files",
    exact: true,
  });
  await expect(explorer.getByText("Embedding: failed")).toBeVisible();
  await expect(
    explorer.getByRole("link", { name: "Other project" }),
  ).toHaveAttribute("href", "/projects/30000000-0000-4000-8000-000000000001");
  await expect(
    explorer.getByRole("button", { name: "Delete selected files" }),
  ).toHaveCount(0);
  await explorer.getByRole("button", { name: "Add library files" }).click();
  const dialog = page.getByRole("dialog");
  const existingFile = dialog.getByRole("button", { name: /shared\.txt/ });
  await expect(existingFile).toBeVisible();
  await expect(existingFile).toBeDisabled();
  await expect(existingFile).toContainText("Already in this project");
  await dialog.getByRole("button", { name: "Select all files" }).click();
  await dialog.getByRole("button", { name: "Add selected (1)" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(explorer.getByText("new.txt", { exact: true })).toBeVisible();
  expect(writes[0].body.file_ids).toEqual([fileIds.new]);
  expect(regenerations).toBe(0);
  await explorer.getByRole("button", { name: "Toggle Search" }).click();
  await explorer.getByRole("textbox", { name: "Search files" }).fill("shared");
  await expect(explorer.getByText("new.txt", { exact: true })).toHaveCount(0);
  await explorer.getByRole("button", { name: "List view" }).click();
  await explorer.getByRole("button", { name: /shared.txt/ }).click();
  await explorer.getByRole("button", { name: "Remove from project" }).click();
  await expect(page.getByRole("alertdialog")).toContainText(
    "Library files, processing artifacts, other projects",
  );
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(explorer.getByText("No files found.")).toBeVisible();
  expect(libraryDeletes).toBe(0);
  await explorer.getByRole("button", { name: "Clear search" }).click();
  await explorer.getByLabel("Choose attachments").setInputFiles({
    name: "uploaded.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Example"),
  });
  await expect(
    explorer.getByText("uploaded.txt", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/project-files-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileName = explorer.getByRole("heading", {
    name: "uploaded.txt",
    exact: true,
  });
  await expect(mobileName).toBeVisible();
  expect((await mobileName.boundingBox())?.width).toBeGreaterThan(60);
  await page.screenshot({
    path: "test-results/project-files-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(writes.map((write) => write.method)).toEqual([
    "POST",
    "DELETE",
    "POST",
  ]);
  expect(errors).toEqual([]);
});
