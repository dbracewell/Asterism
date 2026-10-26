import { expect, request, test, type Page } from "./support/test";
import {
  GENERAL_QUICK_CHATS_OPEN_COOKIE,
  PROJECTS_OPEN_COOKIE,
  SESSIONS_OPEN_COOKIE,
} from "../src/features/dashboard/constants";
import { randomUUID } from "node:crypto";

const email = `${randomUUID()}@example.test`;
const password = "Mobile-shell-321!";
const pageErrors = new WeakMap<Page, string[]>();
test.use({ hasTouch: true });
test.afterEach(async ({ page }, info) => {
  expect(pageErrors.get(page) ?? []).toEqual([]);
  await page.screenshot({ path: info.outputPath("mobile-shell.png") });
});
test.beforeAll(async () => {
  if (process.env.ASTERISM_ISOLATED_E2E !== "true") return;
  const account = await request.newContext({
    baseURL: "http://localhost:3100",
  });
  try {
    const response = await account.post(
      `/api/auth/sign-up/email?adminKey=${encodeURIComponent(process.env.ADMIN_PASSPHRASE!)}`,
      { data: { name: "Mobile tester", email, password } },
    );
    expect(response.ok()).toBeTruthy();
    const user = (await response.json()).user;
    const provision = await account.post("/api/py/users/", {
      data: { user_id: user.id, system_key: process.env.SYSTEM_KEY },
    });
    expect(provision.ok()).toBeTruthy();
  } finally {
    await account.dispose();
  }
});
test.beforeEach(async ({ context, page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  test.skip(
    process.env.ASTERISM_ISOLATED_E2E !== "true",
    "Use isolated storage",
  );
  const response = await context.request.post(
    "http://localhost:3100/api/auth/sign-in/email",
    {
      data: { email, password },
    },
  );
  expect(response.ok()).toBeTruthy();
  await page.route("**/api/py/projects/?**", (route) =>
    route.fulfill({
      json: {
        projects: Array.from(
          {
            length:
              Number(
                new URL(route.request().url()).searchParams.get("page_size"),
              ) || 20,
          },
          (_, i) => ({
            id: `11111111-1111-4111-8111-${String(i + 1).padStart(12, "0")}`,
            name: `Mobile project ${i + 1}`,
            description:
              "A project with enough content to require vertical scrolling.",
            system_prompt: "",
            context_revision: 0,
            created_at: 1,
            updated_at: 1,
          }),
        ),
        total: 40,
        page: 1,
        page_size: 20,
      },
    }),
  );
});
for (const width of [320, 390]) {
  test(`mobile sidebar opens with one tap and restores focus at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 600 });
    await page.goto("/projects");
    const trigger = page.getByRole("button", { name: "Toggle Sidebar" });
    await expect(trigger).toBeVisible();
    const header = trigger.locator("..");
    expect(
      await header.evaluate((node) => ({
        left: node.getBoundingClientRect().left,
        width: node.getBoundingClientRect().width,
      })),
    ).toEqual({ left: 0, width });
    await trigger.tap();
    const sidebar = page.getByRole("dialog", { name: "Sidebar", exact: true });
    await expect(sidebar).toBeVisible();
    const brand = sidebar.getByRole("heading", { name: "ASTERISM" });
    expect(
      await brand.evaluate((el) => getComputedStyle(el).fontFamily),
    ).toMatch(/Schibsted/);
    const headerBounds = await sidebar.evaluate((el) => {
      const heading = el.querySelector("h1")!.getBoundingClientRect();
      const close = el
        .querySelector('[aria-label="Close sidebar"]')!
        .getBoundingClientRect();
      return {
        wordmarkRight: heading.right,
        closeLeft: close.left,
        closeRight: close.right,
        sidebarRight: el.getBoundingClientRect().right,
        closeWidth: close.width,
      };
    });
    expect(headerBounds.wordmarkRight).toBeLessThanOrEqual(
      headerBounds.closeLeft,
    );
    expect(headerBounds.closeRight).toBeLessThanOrEqual(
      headerBounds.sidebarRight,
    );
    expect(headerBounds.closeWidth).toBeGreaterThanOrEqual(44);
    await expect(
      sidebar.getByRole("link", { name: "Files", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sidebar).toBeHidden();
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(sidebar).toBeVisible();
    await sidebar
      .getByRole("button", { name: "Close sidebar", exact: true })
      .tap();
    await expect(sidebar).toBeHidden();
    await trigger.tap();
    await sidebar.getByRole("link", { name: "Files", exact: true }).tap();
    await expect(page).toHaveURL(/\/files$/, { timeout: 30_000 });
    await expect(sidebar).toBeHidden();
    await expect(page.locator("body")).not.toHaveCSS("pointer-events", "none");
  });
  test(`projects and settings scroll to their last controls at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 300 });
    await page.goto("/projects");
    await expect(
      page.getByRole("link", { name: "Mobile project 20", exact: true }),
    ).toBeAttached();
    await page.mouse.move(width / 2, 180);
    await page.mouse.wheel(0, 10000);
    const next = page.getByRole("button", { name: "Next projects" });
    await expect(next).toBeInViewport({ ratio: 1 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await next.tap();
    await page.goto("/settings");
    const model = page.getByRole("combobox", {
      name: "Default Model",
      exact: true,
    });
    await expect(model).toBeAttached();
    await expect(page.locator('[data-slot="tabs"]').nth(1)).toHaveAttribute(
      "data-orientation",
      "horizontal",
    );
    const pane = page.locator('[data-slot="tabs-content"]').last();
    await pane.hover({ position: { x: 12, y: 12 } });
    await page.mouse.wheel(0, 10000);
    await expect(model).toBeInViewport({ ratio: 1 });
    await model.tap();
    await expect(
      page.getByRole("combobox", { name: "Search models…", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  });
}

for (const width of [320, 390]) {
  test(`General and Files scroll after the mobile drawer closes at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 300 });
    await page.route("**/api/py/chat/?**", (route) =>
      route.fulfill({
        json: {
          chats: Array.from({ length: 20 }, (_, i) => ({
            id: `22222222-2222-4222-8222-${String(i + 1).padStart(12, "0")}`,
            title: `Mobile chat ${i + 1}`,
            user_id: "test",
            project_id: null,
            created_at: 1,
            updated_at: 1,
          })),
          total: 40,
          page: 1,
          page_size: 20,
        },
      }),
    );
    await page.route("**/api/py/files/?**", (route) =>
      route.fulfill({
        json: {
          files: Array.from({ length: 20 }, (_, i) => ({
            id: `33333333-3333-4333-8333-${String(i + 1).padStart(12, "0")}`,
            filename: `mobile-file-${i + 1}.txt`,
            original_name: `mobile-file-${i + 1}.txt`,
            size: 100,
            mime_type: "text/plain",
            kind: "document",
            content_status: "pending",
            content_error: null,
            projects: [],
            created_at: 1,
            updated_at: 1,
          })),
          total: 20,
          page: 1,
          page_size: 50,
        },
      }),
    );
    await page.goto("/general");
    await expect(
      page.getByRole("link", { name: "Mobile chat 20", exact: true }),
    ).toBeAttached();
    await page.getByRole("button", { name: "Toggle Sidebar" }).tap();
    const drawer = page.getByRole("dialog", { name: "Sidebar", exact: true });
    await expect(
      drawer.getByRole("button", { name: /Mobile tester/ }),
    ).toBeInViewport({ ratio: 1 });
    await drawer
      .getByRole("button", { name: "Close sidebar", exact: true })
      .tap();
    await expect(drawer).toBeHidden();
    await page.mouse.move(width / 2, 220);
    await page.mouse.wheel(0, 10000);
    await expect(
      page
        .locator('[data-slot="sidebar-inset"]')
        .getByRole("button", { name: "Next chats" }),
    ).toBeInViewport({ ratio: 1 });
    await page.goto("/files");
    const lastFile = page.getByRole("link", {
      name: "Open mobile-file-20.txt",
      exact: true,
    });
    await expect(lastFile).toBeAttached();
    await page.mouse.move(width / 2, 220);
    await page.mouse.wheel(0, 10000);
    await expect(lastFile).toBeInViewport();
    // Center the action in its actual scroll owner; metadata wrapping changes
    // the required wheel distance as the pane narrows.
    const wheelDelta = await lastFile.evaluate((node) => {
      let owner = node.parentElement;
      while (owner) {
        if (
          /(auto|scroll)/.test(getComputedStyle(owner).overflowY) &&
          owner.scrollHeight > owner.clientHeight
        )
          break;
        owner = owner.parentElement;
      }
      if (!owner) throw new Error("File action has no scroll owner");
      const box = node.getBoundingClientRect();
      const bounds = owner.getBoundingClientRect();
      return (
        box.top +
        box.height / 2 -
        (Math.max(0, bounds.top) + Math.min(innerHeight, bounds.bottom)) / 2
      );
    });
    await page.mouse.wheel(0, wheelDelta);
    await expect(lastFile).toBeInViewport({ ratio: 1 });
    expect(
      await lastFile.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const hit = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        );
        return hit === node || node.contains(hit);
      }),
    ).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  });

  test(`new chat controls remain reachable at ${width}px and short height`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 300 });
    await page.route("**/api/py/chat/models", (route) =>
      route.fulfill({ json: [] }),
    );
    await page.goto("/");
    // The empty-model notice adds composer height after the initial query settles.
    await expect(
      page.getByText(
        "No available models. Ask an administrator to enable one.",
      ),
    ).toBeAttached();
    const message = page.getByLabel("Message", { exact: true });
    await expect(message).toBeAttached();
    await page.mouse.move(width / 2, 220);
    await page.mouse.wheel(0, 10000);
    await expect(message).toBeInViewport({ ratio: 1 });
    const title = page
      .locator('[data-slot="sidebar-inset"] > header')
      .getByText("Asterism", { exact: true });
    expect(
      await title.evaluate((node) => {
        const box = node.getBoundingClientRect();
        return (
          document.elementFromPoint(
            box.left + box.width / 2,
            box.top + box.height / 2,
          ) === node
        );
      }),
    ).toBe(true);
    await expect(
      page.getByRole("button", { name: "Toggle Sidebar" }),
    ).toBeInViewport({ ratio: 1 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  });

  test(`saved chat history scrolls independently of its composer at ${width}px`, async ({
    page,
  }) => {
    const chatId = "44444444-4444-4444-8444-444444444444";
    await page.setViewportSize({ width, height: 600 });
    await page.route(`**/api/py/chat/${chatId}`, (route) =>
      route.fulfill({
        json: {
          info: {
            id: chatId,
            user_id: "test",
            title: "Mobile scroll check",
            project_id: null,
            created_at: 1,
            updated_at: 1,
          },
          messages: [
            {
              id: "55555555-5555-4555-8555-555555555555",
              role: "assistant",
              status: "completed",
              created_at: 1,
              content: [
                "FIRST MOBILE PARAGRAPH",
                ...Array.from(
                  { length: 30 },
                  (_, i) =>
                    `Paragraph ${i + 1} gives the history enough content to scroll.`,
                ),
                "FINAL MOBILE PARAGRAPH",
              ].join("\n\n"),
            },
          ],
        },
      }),
    );
    await page.route(`**/api/py/chat/${chatId}/files/context`, (route) =>
      route.fulfill({
        json: {
          chat_id: chatId,
          project_id: null,
          allowed_file_ids: [],
          local_file_ids: [],
          project_file_ids: [],
          unavailable_file_ids: [],
          files: [],
        },
      }),
    );
    await page.routeWebSocket(
      `**/api/py/chat/stream/${chatId}?**`,
      (socket) => {
        socket.send(JSON.stringify({ type: "status", is_processing: false }));
        socket.onMessage((raw) => {
          if (JSON.parse(String(raw)).type === "ping")
            socket.send(JSON.stringify({ type: "pong" }));
        });
      },
    );
    await page.goto(`/c/${chatId}`);
    const last = page.getByText("FINAL MOBILE PARAGRAPH", { exact: true });
    await expect(last).toBeAttached();
    await page.mouse.move(width / 2, 150);
    await page.mouse.wheel(0, 10000);
    await expect(last).toBeInViewport({ ratio: 1 });
    const message = page.getByLabel("Message", { exact: true });
    await expect(message).toBeInViewport({ ratio: 1 });
    const lastBox = await last.boundingBox();
    expect(lastBox).not.toBeNull();
    const formTop = await message.evaluate(
      (node) => node.closest("form")!.getBoundingClientRect().top,
    );
    expect(lastBox!.y + lastBox!.height).toBeLessThanOrEqual(formTop);
    await page.mouse.wheel(0, -10000);
    await expect(
      page.getByText("FIRST MOBILE PARAGRAPH", { exact: true }),
    ).toBeInViewport({ ratio: 1 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  });
}

for (const projectsOpen of [false, true]) {
  test(`sidebar hydrates persisted Projects ${projectsOpen ? "open" : "closed"} and paginates General`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await context.addCookies([
      {
        name: PROJECTS_OPEN_COOKIE,
        value: String(projectsOpen),
        url: "http://localhost:3100",
      },
      {
        name: GENERAL_QUICK_CHATS_OPEN_COOKIE,
        value: "true",
        url: "http://localhost:3100",
      },
      {
        name: SESSIONS_OPEN_COOKIE,
        value: "false",
        url: "http://localhost:3100",
      },
      { name: "sidebar_state", value: "true", url: "http://localhost:3100" },
    ]);
    let empty = false;
    await page.route("**/api/py/chat/?**", (route) => {
      const url = new URL(route.request().url());
      expect(url.searchParams.get("project_id")).toBeNull();
      if (url.searchParams.get("page_size") !== "5") {
        return route.fulfill({
          json: { chats: [], total: 0, page: 1, page_size: 20 },
        });
      }
      const pageNumber = Number(url.searchParams.get("page"));
      return route.fulfill({
        json: {
          chats: empty
            ? []
            : Array.from({ length: pageNumber === 1 ? 5 : 1 }, (_, i) => ({
                id: `general-${pageNumber}-${i}`,
                title: `General chat ${pageNumber}-${i}`,
              })),
          total: empty ? 0 : 6,
          page: pageNumber,
          page_size: 5,
        },
      });
    });
    const hydrationErrors: string[] = [];
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        /hydrat|server rendered/i.test(message.text())
      )
        hydrationErrors.push(message.text());
    });
    await page.goto("/general");
    const sidebar = page.locator('[data-slot="sidebar"]');
    await expect(
      page.getByRole("button", { name: "Toggle Projects", exact: true }),
    ).toHaveAttribute("aria-expanded", String(projectsOpen));
    await expect(
      page.getByRole("link", { name: "General chat 1-4", exact: true }),
    ).toBeVisible();
    await expect(
      sidebar.getByRole("button", { name: "Previous chats", exact: true }),
    ).toBeDisabled();
    await sidebar
      .getByRole("button", { name: "Next chats", exact: true })
      .click();
    await expect(
      page.getByRole("link", { name: "General chat 2-0", exact: true }),
    ).toBeVisible();
    await expect(
      sidebar.getByRole("button", { name: "Next chats", exact: true }),
    ).toBeDisabled();
    await page.reload();
    await expect(
      page.getByRole("link", { name: "General chat 1-0", exact: true }),
    ).toBeVisible();
    empty = true;
    await page.reload();
    await expect(
      sidebar.getByText("No chats yet.", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Collapse sidebar", exact: true })
      .click();
    await expect(
      sidebar.getByText("No chats yet.", { exact: true }),
    ).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Toggle General", exact: true }),
    ).toBeHidden();
    await page
      .getByRole("button", { name: "Expand sidebar", exact: true })
      .click();
    await expect(
      sidebar.getByText("No chats yet.", { exact: true }),
    ).toBeVisible();
    expect(hydrationErrors).toEqual([]);
  });
}

test("General quick chats and workspace context coexist with aligned full-row selection", async ({
  page,
  context,
}) => {
  const tokenResponse = await context.request.get(
    "http://localhost:3100/api/auth/token",
  );
  expect(tokenResponse.ok()).toBeTruthy();
  const { token } = await tokenResponse.json();
  const themeResponse = await context.request.put(
    "http://localhost:3100/api/py/settings/user/theme",
    {
      headers: { Authorization: `Bearer ${token}` },
      data: { value: "dark" },
    },
  );
  expect(themeResponse.ok()).toBeTruthy();
  await page.setViewportSize({ width: 1280, height: 720 });
  await context.addCookies([
    {
      name: "asterism-custom-theme-name",
      value: "dark",
      url: "http://localhost:3100",
    },
    {
      name: GENERAL_QUICK_CHATS_OPEN_COOKIE,
      value: "true",
      url: "http://localhost:3100",
    },
    { name: SESSIONS_OPEN_COOKIE, value: "true", url: "http://localhost:3100" },
    {
      name: PROJECTS_OPEN_COOKIE,
      value: "false",
      url: "http://localhost:3100",
    },
    { name: "sidebar_state", value: "true", url: "http://localhost:3100" },
  ]);
  await page.route("**/api/py/chat/?**", (route) => {
    const url = new URL(route.request().url());
    const size = Number(url.searchParams.get("page_size"));
    const pageNumber = Number(url.searchParams.get("page"));
    expect(url.searchParams.get("project_id")).toBeNull();
    return route.fulfill({
      json: {
        chats: Array.from(
          { length: size === 5 ? 5 : size === 50 ? 10 : 0 },
          (_, i) => ({
            id: `context-${pageNumber}-${i}`,
            title: `Context chat ${pageNumber}-${i}`,
          }),
        ),
        total: 51,
        page: pageNumber,
        page_size: size,
      },
    });
  });
  await page.goto("/general");
  await expect(page.locator("body")).toHaveClass(/dark/);
  const quick = page.getByRole("region", { name: "General", exact: true });
  const contextList = page.getByRole("region", {
    name: "General chats",
    exact: true,
  });
  await expect(quick.getByRole("link", { name: /Context chat/ })).toHaveCount(
    5,
  );
  await expect(
    contextList.getByRole("link", { name: /Context chat/ }),
  ).toHaveCount(10);
  await expect(
    contextList.getByRole("link", { name: "Context chat 1-9", exact: true }),
  ).toBeVisible();
  const generalRow = page.locator('[data-workspace-row="General"]');
  const projectRow = page.locator('[data-workspace-row="Projects"]');
  // Expansion is a disclosure state, not a selected/filled button state.
  await expect(
    projectRow.getByRole("button", { name: "Toggle Projects", exact: true }),
  ).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await projectRow
    .getByRole("button", { name: "Toggle Projects", exact: true })
    .click();
  await page.mouse.move(800, 100);
  await generalRow.getByRole("link", { name: "General", exact: true }).focus();
  await expect(
    projectRow.getByRole("button", { name: "Toggle Projects", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    projectRow.getByRole("button", { name: "Toggle Projects", exact: true }),
  ).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const lowerLabel = await contextList
    .locator('[data-slot="sidebar-group-label"]')
    .boundingBox();
  const lowerToggle = await contextList
    .getByRole("button", { name: "Toggle General chats", exact: true })
    .boundingBox();
  expect(lowerLabel!.x).toBeCloseTo(lowerToggle!.x + lowerToggle!.width, 0);
  await expect(
    contextList.getByRole("button", { name: "Select chats", exact: true }),
  ).toBeEnabled();
  const generalText = await generalRow.locator("a span").boundingBox();
  const projectText = await projectRow.locator("a span").boundingBox();
  expect(generalText!.x).toBeCloseTo(projectText!.x, 0);
  const generalBounds = await generalRow.boundingBox();
  const projectBounds = await projectRow.boundingBox();
  expect(generalBounds!.x).toBeCloseTo(projectBounds!.x, 0);
  expect(generalBounds!.width).toBeCloseTo(projectBounds!.width, 0);
  await expect(generalRow).toHaveAttribute("data-active", "true");
  await expect(projectRow).toHaveAttribute("data-active", "false");
  const rowColor = await generalRow.evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  expect(rowColor).not.toBe("rgba(0, 0, 0, 0)");
  await quick
    .getByRole("button", { name: "Toggle General", exact: true })
    .click();
  await expect(quick.getByRole("link", { name: /Context chat/ })).toHaveCount(
    0,
  );
  await expect(
    contextList.getByRole("link", { name: /Context chat/ }),
  ).toHaveCount(10);
  await page.reload();
  await expect(
    quick.getByRole("button", { name: "Toggle General", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(
    contextList.getByRole("link", { name: /Context chat/ }),
  ).toHaveCount(10);
  await contextList
    .getByRole("button", { name: "Next chats", exact: true })
    .click();
  await expect(
    contextList.getByRole("link", { name: "Context chat 2-0", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Collapse sidebar", exact: true })
    .click();
  await expect(
    contextList.getByRole("button", { name: "Next chats", exact: true }),
  ).toBeHidden();
  await page
    .getByRole("button", { name: "Expand sidebar", exact: true })
    .click();
  await expect(
    contextList.getByRole("link", { name: "Context chat 2-0", exact: true }),
  ).toBeVisible();
});
