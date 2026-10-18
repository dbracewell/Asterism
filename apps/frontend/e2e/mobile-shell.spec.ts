import { expect, request, test, type Page } from "@playwright/test";
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
    const model = page.getByRole("button", {
      name: "Select a model...",
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
      page.getByRole("textbox", { name: "Filter models" }),
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
    // A card can be taller than this short pane. Scroll back slightly to expose
    // its action above the processing-status text, using the real scroll owner.
    await page.mouse.wheel(0, -10);
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
    await page.goto("/");
    const message = page.getByRole("textbox", { name: "Message", exact: true });
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
    const message = page.getByRole("textbox", { name: "Message", exact: true });
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
