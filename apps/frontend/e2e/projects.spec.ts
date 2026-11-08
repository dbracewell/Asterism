import { expect, test } from "./support/test";
const P = "11111111-1111-4111-8111-111111111111";
const Q = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const base = {
  id: P,
  name: "Research",
  description: "Study ocean currents",
  system_prompt: "Cite evidence",
  context_revision: 3,
  goal: "",
  goal_target_date: null,
  areas: { study: true, reflections: true, goal: true, sub_agents: true },
  created_at: 1,
  updated_at: 1,
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/py/projects/*/sub-agents?**", (route) =>
    route.fulfill({
      json: {
        agents: [],
        total: 0,
        page: 1,
        page_size: 10,
        context_revision: 3,
      },
    }),
  );
  await page.route("**/api/py/projects/*/sub-agent-candidates?**", (route) =>
    route.fulfill({
      json: {
        agents: [],
        total: 0,
        page: 1,
        page_size: 10,
        context_revision: 3,
      },
    }),
  );
  await page.route("**/api/py/chat/models", (route) =>
    route.fulfill({ json: [] }),
  );
});

test("browses Projects and General, searches, paginates, and offers scoped new chats", async ({
  page,
}) => {
  await page.route("**/api/py/projects/?**", (route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get("query");
    const second = url.searchParams.get("page") === "2";
    return route.fulfill({
      json: {
        projects:
          query === "missing"
            ? []
            : [second ? { ...base, id: Q, name: "Other work" } : base],
        total: query === "missing" ? 0 : 21,
        page: second ? 2 : 1,
        page_size: 20,
      },
    });
  });
  await page.route(
    (url) => url.pathname === `/api/py/projects/${P}`,
    (route) => route.fulfill({ json: base }),
  );
  await page.route(`**/api/py/projects/${P}/study/decks?**`, (route) =>
    route.fulfill({ json: { items: [], total: 0, page: 1, page_size: 20 } }),
  );
  await page.route(`**/api/py/projects/${P}/study/summary`, (route) =>
    route.fulfill({ json: { deck_count: 0, card_count: 0, due_count: 0 } }),
  );
  await page.route(`**/api/py/projects/${P}/study/quizzes?**`, (route) =>
    route.fulfill({ json: { items: [], total: 0, page: 1, page_size: 20 } }),
  );
  await page.route(`**/api/py/projects/${P}/study/weak-spots?**`, (route) =>
    route.fulfill({ json: { items: [], total: 0 } }),
  );
  await page.route(`**/api/py/projects/${P}/study/notes?**`, (route) =>
    route.fulfill({ json: { items: [], total: 0, page: 1, page_size: 20 } }),
  );
  const scopes: Array<string | null> = [];
  await page.route("**/api/py/chat/?**", (route) => {
    scopes.push(new URL(route.request().url()).searchParams.get("project_id"));
    return route.fulfill({
      json: { chats: [], total: 0, page: 1, page_size: 20 },
    });
  });
  await page.goto("/e2e/projects");
  await expect(
    page.getByRole("link", { name: "General", exact: true }),
  ).toHaveAttribute("href", "/general");
  await expect(
    page.getByRole("link", { name: "Projects", exact: true }),
  ).toHaveAttribute("href", "/projects");
  await expect(
    page.locator("main").getByRole("link", { name: "Research" }),
  ).toHaveAttribute("href", `/projects/${P}`, { timeout: 15_000 });
  await page.getByRole("button", { name: "Next projects" }).click();
  await expect(page.locator("main").getByText("Other work")).toBeVisible();
  await page.getByLabel("Search projects").fill("missing");
  await expect(page.getByText("No matching projects")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Previous projects" }),
  ).toBeDisabled();
  await page.goto("/e2e/projects?view=project");
  await expect(
    page.getByRole("heading", { name: "Research", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "New chat" })).toHaveAttribute(
    "href",
    `/?project_id=${P}`,
  );
  await expect(page.getByText("No chats yet")).toBeVisible();
  // US-65.1: sections are tabs; arrow keys move between them and the URL follows.
  const sections = page.getByRole("tablist", { name: "Project sections" });
  const overview = sections.getByRole("tab", { name: "Overview" });
  await expect(overview).toHaveAttribute("aria-selected", "true");
  await overview.focus();
  for (const [name, tab] of [
    ["Chats", "chats"],
    ["Files", "files"],
    ["Study", "study"],
  ]) {
    await page.keyboard.press("ArrowRight");
    const next = sections.getByRole("tab", { name });
    await expect(next).toBeFocused();
    await expect(next).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(new RegExp(`[?&]tab=${tab}(&|$)`));
  }
  await expect(page.getByText("No decks yet")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/[?&]tab=files(&|$)/);
  await expect(sections.getByRole("tab", { name: "Files" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.goto("/e2e/projects?view=project&tab=study");
  await expect(page.getByText("No decks yet")).toBeVisible();
  await page.screenshot({
    path: "test-results/projects-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/projects-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  // At 320px the tab row scrolls inside itself and every tab stays reachable.
  await page.setViewportSize({ width: 320, height: 640 });
  await sections.getByRole("tab", { name: "Study" }).focus();
  await page.keyboard.press("End");
  const settingsTab = sections.getByRole("tab", { name: "Settings" });
  await expect(settingsTab).toBeFocused();
  await expect(settingsTab).toBeInViewport();
  await expect(page.getByLabel("Project instructions")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.goto("/e2e/projects?view=general");
  await expect(page.getByRole("link", { name: "New chat" })).toHaveAttribute(
    "href",
    "/",
  );
  await expect(page.getByText("No chats yet")).toBeVisible();
  expect(scopes).toContain(P);
  expect(scopes).toContain(null);
});

test("edits project instructions with a revision guard and explains deletion", async ({
  page,
}) => {
  let current = { ...base };
  const updates: unknown[] = [];
  await page.route("**/api/py/projects/?**", (route) =>
    route.fulfill({
      json: { projects: [current], total: 1, page: 1, page_size: 5 },
    }),
  );
  await page.route(
    (url) => url.pathname === `/api/py/projects/${P}`,
    (route) => {
      if (route.request().method() === "PATCH") {
        const body = route.request().postDataJSON();
        updates.push(body);
        current = { ...current, ...body, context_revision: 4 };
      }
      if (route.request().method() === "DELETE") {
        expect(
          new URL(route.request().url()).searchParams.get(
            "expected_context_revision",
          ),
        ).toBe("4");
      }
      return route.fulfill({ json: current });
    },
  );
  await page.goto("/e2e/projects?view=project&tab=settings");
  await expect(page.getByLabel("Project instructions")).toHaveValue(
    "Cite evidence",
  );
  await page.getByLabel("Project instructions").fill("Use concise citations");
  await page.getByLabel("Learning goal").fill("Publish a currents report");
  await page.getByLabel("Target date (optional)").fill("2026-12-01");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Project settings saved" }),
  ).toHaveText(/Project settings saved/);
  expect(updates).toEqual([
    {
      name: "Research",
      description: "Study ocean currents",
      system_prompt: "Use concise citations",
      goal: "Publish a currents report",
      goal_target_date: "2026-12-01",
      areas: { study: true, reflections: true, goal: true, sub_agents: true },
      expected_context_revision: 3,
    },
  ]);
  await page.getByRole("button", { name: "Delete project" }).click();
  await expect(page.getByRole("alertdialog")).toContainText(
    "Chats will move to General with their history and local attachments",
  );
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByLabel("Project instructions")).toHaveValue(
    "Use concise citations",
  );
  await page.getByRole("button", { name: "Delete project" }).click();
  const deleted = page.waitForRequest(
    (request) =>
      request.method() === "DELETE" && request.url().includes(`/projects/${P}`),
  );
  await page.getByRole("button", { name: "Confirm" }).click();
  await deleted;
  await expect(page).toHaveURL(/sign-in\?redirect=%2Fgeneral/, {
    timeout: 30_000,
  });
  await expect(page.getByRole("heading", { name: "ASTERISM" })).toBeVisible();
});

test("turns feature areas off from Settings and hides their tabs", async ({
  page,
}) => {
  let current = { ...base, goal: "Map the gyres" };
  const updates: { areas?: unknown }[] = [];
  await page.route("**/api/py/projects/?**", (route) =>
    route.fulfill({
      json: { projects: [current], total: 1, page: 1, page_size: 5 },
    }),
  );
  await page.route(
    (url) => url.pathname === `/api/py/projects/${P}`,
    (route) => {
      if (route.request().method() === "PATCH") {
        const body = route.request().postDataJSON();
        updates.push(body);
        current = { ...current, ...body, context_revision: 3 };
      }
      return route.fulfill({ json: current });
    },
  );
  await page.goto("/e2e/projects?view=project&tab=settings");
  const tabs = page.getByRole("tablist", { name: "Project sections" });
  await expect(tabs.getByRole("tab")).toHaveCount(7);

  // Switches work from the keyboard.
  const study = page.getByRole("switch", { name: "Study" });
  await study.focus();
  await page.keyboard.press("Space");
  await expect(study).not.toBeChecked();
  await page.getByRole("switch", { name: "Goal" }).click();
  await expect(page.getByLabel("Learning goal")).toHaveCount(0);
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Project settings saved" }),
  ).toBeVisible();
  expect(updates.map((update) => update.areas)).toEqual([
    { study: false, reflections: true, goal: false, sub_agents: true },
  ]);
  await expect(tabs.getByRole("tab")).toHaveText([
    "Overview",
    "Chats",
    "Files",
    "Reflections",
    "Sub-agents",
    "Settings",
  ]);

  // A link to the hidden tab opens Overview, without the hidden goal.
  await page.goto("/e2e/projects?view=project&tab=study");
  await expect(tabs.getByRole("tab", { name: "Overview" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText("Map the gyres")).toHaveCount(0);
});

test("moves a chat to General with explicit history transfer and updates its identity", async ({
  page,
}) => {
  let projectId: string | null = P;
  await page.route("**/api/py/projects/?**", (route) =>
    route.fulfill({
      json: { projects: [base], total: 1, page: 1, page_size: 10 },
    }),
  );
  await page.route(
    (url) => url.pathname === `/api/py/projects/${P}`,
    (route) => route.fulfill({ json: base }),
  );
  await page.route(`**/api/py/chat/${C}`, (route) =>
    route.fulfill({
      json: {
        info: {
          id: C,
          user_id: "test",
          project_id: projectId,
          title: "Existing chat",
          created_at: 1,
          updated_at: 1,
        },
        messages: [],
      },
    }),
  );
  await page.route(`**/api/py/chat/${C}/project`, (route) => {
    expect(route.request().postDataJSON()).toEqual({ project_id: null });
    projectId = null;
    return route.fulfill({
      json: {
        id: C,
        user_id: "test",
        project_id: null,
        created_at: 1,
        updated_at: 1,
      },
    });
  });
  await page.route("**/api/py/users/personas", (route) =>
    route.fulfill({
      json: { profiles: [], default_persona_id: "none", default_revision: 1 },
    }),
  );
  await page.goto("/e2e/projects?view=chat");
  const header = page.locator('[data-slot="app-header"]');
  await expect(header.getByRole("link", { name: "Research" })).toBeVisible();
  await header.getByRole("button", { name: "Chat actions" }).click();
  await page.getByRole("menuitem", { name: "Move" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Historical answers may contain information from the previous project",
  );
  await page.getByLabel("Destination workspace").click();
  await page.getByRole("option", { name: "General", exact: true }).click();
  await page.getByRole("button", { name: "Move to workspace" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    header.getByRole("link", { name: "General", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Existing conversation history")).toBeVisible();
});

test("creates a project with independent task instructions", async ({
  page,
}) => {
  await page.route("**/api/py/projects/**", (route) => {
    if (route.request().method() === "POST")
      return route.fulfill({ json: base });
    return route.fulfill({
      json: { projects: [], total: 0, page: 1, page_size: 20 },
    });
  });
  // The wizard works on the narrowest supported screen.
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/e2e/projects");
  await page.getByRole("button", { name: "New project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByRole("radio", { name: "Blank" }).click();
  await dialog.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Research");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Study ocean currents");
  await dialog.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("Project instructions").fill("Cite evidence");
  await dialog.getByRole("button", { name: "Next" }).click();
  await dialog.getByRole("button", { name: "Next" }).click();
  await expect(dialog).toContainText("Step 5 of 5: Review");
  expect(
    await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  const created = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().includes("/projects/"),
  );
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  expect((await created).postDataJSON()).toEqual({
    name: "Research",
    description: "Study ocean currents",
    system_prompt: "Cite evidence",
    accent: null,
    goal: "",
    goal_target_date: null,
    areas: { study: true, reflections: true, goal: true, sub_agents: true },
    file_ids: [],
  });
  await expect(page).toHaveURL(/sign-in\?redirect=%2Fprojects%2F/);
  await expect(page.getByRole("heading", { name: "ASTERISM" })).toBeVisible();
});

test("retries failed project loading without showing a false empty state", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/api/py/projects/?**", (route) =>
    fail
      ? route.fulfill({
          status: 503,
          json: { detail: "Workspace service offline" },
        })
      : route.fulfill({
          json: { projects: [base], total: 1, page: 1, page_size: 20 },
        }),
  );
  await page.goto("/e2e/projects");
  const main = page.locator("main");
  await expect(main.getByRole("alert")).toContainText(
    "Workspace service offline",
  );
  await expect(main.getByText("No projects yet")).not.toBeVisible();
  fail = false;
  await main.getByRole("button", { name: "Retry" }).click();
  await expect(main.getByRole("link", { name: "Research" })).toBeVisible();
});
