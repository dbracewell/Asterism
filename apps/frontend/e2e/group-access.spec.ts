import { expect, test } from "./support/test";

// US-70.3: an administrator limits Student to one model and moves someone into
// another group, and a student's picker shows only what the group allows.
// Enforcement itself is covered by the backend tests (test_group_access.py);
// this checks the screens around it.
const FAST = "11111111-1111-4111-8111-111111111111";
const BIG = "22222222-2222-4222-8222-222222222222";
const provider_id = "33333333-3333-4333-8333-333333333333";

const groups = [
  { id: "admin", name: "Admin", built_in: true, member_count: 1 },
  { id: "educator", name: "Educator", built_in: true, member_count: 2 },
  { id: "student", name: "Student", built_in: true, member_count: 30 },
  { id: "night", name: "Night school", built_in: false, member_count: 0 },
].map((group) => ({ ...group, models: null, tools: null }));

test("an administrator limits Student to one model and moves a user", async ({
  page,
}) => {
  const writes: { method: string; path: string; body: unknown }[] = [];
  await page.route("**/api/py/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/py", "");
    if (request.method() !== "GET") {
      writes.push({
        method: request.method(),
        path,
        body: request.postDataJSON(),
      });
    }
    if (path === "/groups/access-options") {
      return route.fulfill({
        json: {
          models: [
            { id: FAST, name: "Fast", provider_name: "Local", enabled: true },
            { id: BIG, name: "Big", provider_name: "Cloud", enabled: true },
          ],
          tools: [
            { name: "web_fetch", description: "Read a page", enabled: true },
          ],
        },
      });
    }
    if (path === "/groups/student/access") {
      return route.fulfill({
        json: { ...groups[2], models: [FAST], tools: null },
      });
    }
    if (path === "/groups") return route.fulfill({ json: groups });
    if (path.startsWith("/groups/members/")) {
      return route.fulfill({ json: { id: "night", name: "Night school" } });
    }
    if (path === "/users/") {
      return route.fulfill({
        json: {
          items: [
            {
              id: "u-ana",
              name: "Ana",
              email: "ana@example.test",
              educator: null,
              group: { id: "student", name: "Student" },
              created_at: 1_700_000_000,
            },
          ],
          total: 1,
          page: 1,
          page_size: 50,
        },
      });
    }
    return route.fulfill({
      status: 503,
      json: { detail: "Fixture unavailable" },
    });
  });

  await page.goto("/e2e/planned-settings?setting=group-settings");
  const student = page.getByRole("listitem", { name: "Student" });
  await expect(student).toContainText("30 members · all models · all tools");
  await expect(
    student.getByRole("button", { name: /Delete|Rename/ }),
  ).toHaveCount(0);
  await student
    .getByRole("button", { name: "Edit access for Student" })
    .click();
  await student
    .getByRole("radiogroup", { name: "Models" })
    .getByRole("radio", { name: "Only the ones checked below" })
    .click();
  await student.getByRole("checkbox", { name: /Fast/ }).check();
  await student
    .getByRole("button", { name: "Save access for Student" })
    .click();
  await expect(student.getByRole("status")).toContainText("Access saved");

  await page
    .getByRole("tablist")
    .last()
    .getByRole("tab", { name: "Users", exact: true })
    .click();
  await page.getByRole("combobox", { name: "Group for Ana" }).click();
  await expect(page.getByRole("option", { name: "Admin" })).toHaveCount(0);
  await page.getByRole("option", { name: "Night school" }).click();

  await expect
    .poll(() => writes)
    .toEqual([
      {
        method: "PUT",
        path: "/groups/student/access",
        body: { models: [FAST], tools: null },
      },
      {
        method: "PUT",
        path: "/groups/members/u-ana",
        body: { group_id: "night" },
      },
    ]);
});

test("a student's model picker lists only what their group allows", async ({
  page,
}) => {
  const choice = {
    provider_id,
    provider_name: "Local",
    provider_type: "generic_openai",
    supports_vision: false,
    context_window: 4096,
  };
  // The server leaves Big out of the list for this student's group.
  await page.route("**/api/py/chat/models", (route) =>
    route.fulfill({
      json: [{ ...choice, id: FAST, name: "Fast", available: true }],
    }),
  );
  await page.goto("/e2e/chat-models");
  await page.getByLabel("Chat model").click();
  await expect(page.getByRole("option", { name: /Big/ })).toHaveCount(0);
  await expect(
    page.getByRole("option", { name: "Fast (Local)" }),
  ).toBeVisible();
});
