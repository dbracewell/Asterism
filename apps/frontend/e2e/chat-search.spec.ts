import { expect, test } from "@playwright/test";

test("searches projects and chats, shows membership, and paginates", async ({
  page,
}) => {
  await page.route("**/api/py/chat/search?**", (route) => {
    const url = new URL(route.request().url());
    const currentPage = Number(url.searchParams.get("page"));
    expect(url.searchParams.get("q")).toBe("ocean");
    expect(url.searchParams.get("page_size")).toBe("20");
    return route.fulfill({
      json: {
        results:
          currentPage === 1
            ? [
                {
                  kind: "project",
                  id: "project-a",
                  title: "Marine research",
                  updated_at: 1,
                  project_id: "project-a",
                  project_name: "Marine research",
                  match_source: "project_description",
                  snippet: "Study ocean circulation",
                },
                {
                  kind: "chat",
                  id: "chat-a",
                  title: "Ocean notes",
                  updated_at: 1,
                  project_id: "project-a",
                  project_name: "Marine research",
                  match_source: "title",
                  snippet: "Ocean notes",
                },
              ]
            : [
                {
                  kind: "chat",
                  id: "chat-b",
                  title: "More notes",
                  updated_at: 0,
                  project_id: null,
                  project_name: null,
                  match_source: "content",
                  snippet: "More ocean observations",
                },
              ],
        total: 21,
        page: currentPage,
        page_size: 20,
      },
    });
  });
  await page.goto("/e2e/chat-search");
  await page
    .getByRole("textbox", { name: "Search chats and projects" })
    .fill("ocean");
  await expect(
    page.getByText("Project description", { exact: true }),
  ).toBeVisible();
  const projectChat = page.getByRole("link", { name: /Ocean notes/ });
  await expect(projectChat).toHaveAttribute("href", "/c/chat-a");
  await expect(projectChat).toContainText("Marine research");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  const generalChat = page.getByRole("link", { name: /More notes/ });
  await expect(generalChat).toContainText("General");
  await expect(
    page.getByRole("button", { name: "Next", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(projectChat).toBeVisible();
});
