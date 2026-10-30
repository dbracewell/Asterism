import { mockDefaultPersonas } from "./support/personas";
import { expect, test, type Page } from "./support/test";
import type { Chat, ChatModelChoice, Message } from "../src/lib/client";

const M = "11111111-1111-4111-8111-111111111111";
const C = "77777777-7777-4777-8777-777777777777";
// 2026-10-27 15:00 UTC is 2026-10-28 00:00 in Tokyo.
const NOW = Date.parse("2026-10-27T15:00:00Z");
const at = (msAgo: number) => (NOW - msAgo) / 1000;
const HOUR = 3_600_000;

const model: ChatModelChoice = {
  id: M,
  name: "Alpha",
  provider_id: "33333333-3333-4333-8333-333333333333",
  provider_name: "Provider",
  provider_type: "generic_openai",
  available: true,
  supports_tools: false,
  context_window: 4096,
};

const messages: Message[] = [
  {
    id: "88888888-8888-4888-8888-000000000001",
    role: "user",
    created_at: at(72 * HOUR),
    status: "completed",
    content: "Name the brightest stars in Orion.",
  },
  {
    id: "88888888-8888-4888-8888-000000000002",
    role: "assistant",
    created_at: at(72 * HOUR),
    status: "cancelled",
    content: "Rigel and Betelgeuse lead the",
    parent_message_id: "88888888-8888-4888-8888-000000000001",
  },
  {
    id: "88888888-8888-4888-8888-000000000003",
    role: "user",
    created_at: at(2 * HOUR),
    status: "completed",
    content: "What is an asterism?",
  },
  {
    id: "88888888-8888-4888-8888-000000000004",
    role: "assistant",
    created_at: at(2 * HOUR),
    status: "completed",
    content:
      "A recognisable pattern of stars that is not itself a constellation, such as the Big Dipper.",
    parent_message_id: "88888888-8888-4888-8888-000000000003",
    output_tokens: 120,
    generation_duration_ms: 4000,
  },
];

async function openChat(page: Page, timezone: string) {
  await mockDefaultPersonas(page);
  await page.clock.setFixedTime(NOW);
  const chat: Chat = {
    info: {
      id: C,
      user_id: "test",
      title: "Anatomy",
      created_at: at(72 * HOUR),
      updated_at: at(2 * HOUR),
      selected_model_id: M,
      selected_model: model,
      model_revision: 1,
      project_id: null,
    },
    messages,
  };
  await page.route("**/api/py/chat/models", (route) =>
    route.fulfill({ json: [model] }),
  );
  await page.route(`**/api/py/chat/${C}/files/context`, (route) =>
    route.fulfill({
      json: {
        chat_id: C,
        project_id: null,
        allowed_file_ids: [],
        unavailable_file_ids: [],
        files: [],
      },
    }),
  );
  await page.route(`**/api/py/chat/${C}`, (route) =>
    route.fulfill({ json: chat }),
  );
  await page.routeWebSocket(`**/api/py/chat/stream/${C}?**`, (socket) => {
    socket.send(JSON.stringify({ type: "status", is_processing: false }));
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type === "ping") {
        socket.send(JSON.stringify({ type: "pong" }));
      }
    });
  });
  await page.goto(`/e2e/chat-model-session?timezone=${timezone}`);
  await expect(page.getByText("Big Dipper")).toBeVisible({ timeout: 15_000 });
}

const assistant = (page: Page) =>
  page.getByRole("article", { name: "Assistant message" });
const meta = (page: Page, index: number) =>
  assistant(page).nth(index).locator("[data-slot=message-meta]");

test("marks assistant turns, styles user bubbles and reveals metadata on hover or focus", async ({
  page,
}) => {
  await openChat(page, "Asia/Tokyo");

  await expect(page.getByRole("article", { name: "Your message" })).toHaveCount(
    2,
  );
  await expect(
    assistant(page).locator("[data-slot=message-marker]:not(.invisible)"),
  ).toHaveCount(2);

  // Quiet until the message is hovered.
  const latest = meta(page, 1);
  await expect(latest).toHaveText("2 hours ago · 30.0 tok/s");
  await expect(latest.locator("..")).toHaveCSS("opacity", "0");
  await assistant(page).nth(1).hover();
  await expect(latest.locator("..")).toHaveCSS("opacity", "1");

  // The stopped reply three Tokyo days back reads in days, not hours.
  await expect(meta(page, 0)).toHaveText("Stopped · 3 days ago");

  // Keyboard: Tab from the copy action reaches the time and its full timestamp.
  await page.mouse.move(0, 0);
  await assistant(page).nth(1).getByRole("button", { name: "Copy" }).focus();
  await page.keyboard.press("Tab");
  const time = latest.locator("time");
  await expect(time).toBeFocused();
  await expect(latest.locator("..")).toHaveCSS("opacity", "1");
  await expect(time).toHaveAccessibleDescription(
    "Tuesday, October 27, 2026 at 10:00:00 PM GMT+9",
  );
});

test.describe("touch", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });

  test("shows metadata without hover and opens the full timestamp on tap", async ({
    page,
  }) => {
    await openChat(page, "UTC");
    const latest = meta(page, 1);
    await expect(latest.locator("..")).toHaveCSS("opacity", "1");
    const time = latest.locator("time");
    await time.tap();
    await expect(time).toHaveAccessibleDescription(
      "Tuesday, October 27, 2026 at 1:00:00 PM UTC",
    );
  });
});
