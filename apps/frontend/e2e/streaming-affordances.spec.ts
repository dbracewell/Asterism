import { mockDefaultPersonas } from "./support/personas";
import { expect, test, type Page, type WebSocketRoute } from "./support/test";
import type { Chat, ChatModelChoice, Message } from "../src/lib/client";

const M = "11111111-1111-4111-8111-111111111111";
const C = "77777777-7777-4777-8777-777777777777";

const model: ChatModelChoice = {
  id: M,
  name: "Alpha",
  provider_id: "33333333-3333-4333-8333-333333333333",
  provider_name: "Provider",
  available: true,
  supports_tools: true,
  context_window: 4096,
};

// Enough history that the transcript scrolls; it ends on the user's turn.
const messages: Message[] = Array.from({ length: 13 }, (_, index) => ({
  id: `88888888-8888-4888-8888-${String(index + 1).padStart(12, "0")}`,
  role: index % 2 ? "assistant" : "user",
  created_at: 0,
  status: "completed",
  content: `History ${index}\n\n${"Long settled paragraph. ".repeat(30)}`,
}));
const jump = (page: Page) =>
  page.getByRole("button", { name: "Jump to latest message" });
const history = (page: Page) =>
  page.getByRole("region", { name: "Conversation history" });
const pending = (page: Page) =>
  history(page).getByRole("status").filter({ hasText: "Assistant is working" });

async function openChat(page: Page) {
  await mockDefaultPersonas(page);
  const chat: Chat = {
    info: {
      id: C,
      user_id: "test",
      title: "Streaming",
      created_at: 0,
      updated_at: 0,
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
  const transport: { socket?: WebSocketRoute } = {};
  await page.routeWebSocket(`**/api/py/chat/stream/${C}?**`, (socket) => {
    transport.socket = socket;
    socket.send(JSON.stringify({ type: "status", is_processing: false }));
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type === "ping") {
        socket.send(JSON.stringify({ type: "pong" }));
      }
    });
  });
  await page.goto("/e2e/chat-model-session");
  await expect(history(page).getByText("History 12")).toBeVisible({
    timeout: 15_000,
  });
  await expect.poll(() => transport.socket).toBeDefined();
  return transport.socket!;
}

const distanceFromBottom = (page: Page) =>
  history(page).evaluate(
    (node) => node.scrollHeight - node.scrollTop - node.clientHeight,
  );

test("shows twinkling stars while the agent works, then hands over to the reply", async ({
  page,
}) => {
  const socket = await openChat(page);
  await expect(pending(page)).toHaveCount(0);
  socket.send(JSON.stringify({ type: "status", is_processing: true }));
  await expect(pending(page)).toBeVisible();
  await expect(pending(page)).toHaveAttribute("data-variant", "turn");
  await expect(pending(page).locator("circle").first()).toHaveCSS(
    "animation-name",
    "twinkle",
  );

  socket.send(JSON.stringify({ type: "start" }));
  socket.send(
    JSON.stringify({ type: "delta", thinking: "", content: "First words" }),
  );
  await expect(history(page).getByText("First words")).toBeVisible();
  // The live reply trails a single inline indicator instead.
  await expect(pending(page)).toHaveCount(1);
  await expect(pending(page)).toHaveAttribute("data-variant", "inline");
});

test("holds the stars still and lit under reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const socket = await openChat(page);
  socket.send(JSON.stringify({ type: "status", is_processing: true }));
  const star = pending(page).locator("circle").first();
  await expect(star).toHaveCSS("animation-name", "none");
  await expect(star).toHaveCSS("opacity", "1");
});

test("offers jump to latest once the user scrolls up during streaming", async ({
  page,
}) => {
  const socket = await openChat(page);
  socket.send(JSON.stringify({ type: "status", is_processing: true }));
  socket.send(JSON.stringify({ type: "start" }));
  let content = "Live start";
  socket.send(JSON.stringify({ type: "delta", thinking: "", content }));
  await expect(history(page).getByText("Live start")).toBeInViewport();
  await expect.poll(() => distanceFromBottom(page)).toBeLessThan(16);
  // Following the bottom: nothing to jump to.
  await expect(jump(page)).toHaveCount(0);

  // A small nudge (well under the idle threshold) is enough while streaming.
  await history(page).evaluate((node) => {
    node.scrollTop = node.scrollHeight - node.clientHeight - 80;
  });
  await expect(jump(page)).toBeVisible();
  await expect(jump(page)).toHaveText("Jump to latest");
  const parked = await history(page).evaluate((node) => node.scrollTop);

  for (let index = 0; index < 6; index++) {
    content += `\n\nStreamed paragraph ${index}. ${"More text. ".repeat(20)}`;
    socket.send(JSON.stringify({ type: "delta", thinking: "", content }));
  }
  await expect(history(page).getByText("Streamed paragraph 5")).toBeAttached();
  // The reader keeps their place while the reply grows below.
  expect(
    Math.abs((await history(page).evaluate((node) => node.scrollTop)) - parked),
  ).toBeLessThan(2);
  await expect(
    history(page).getByText("Streamed paragraph 5"),
  ).not.toBeInViewport();

  // The pill floats over the transcript instead of pushing the composer.
  const composer = page.locator('[data-slot="chat-composer"]');
  const composerBox = await composer.boundingBox();
  const jumpBox = await jump(page).boundingBox();
  expect(jumpBox!.y + jumpBox!.height).toBeLessThanOrEqual(composerBox!.y);

  await jump(page).focus();
  await page.keyboard.press("Enter");
  await expect(
    history(page).getByText("Streamed paragraph 5"),
  ).toBeInViewport();
  await expect(jump(page)).toHaveCount(0);

  // Following resumes for later deltas.
  content += "\n\nTail marker";
  socket.send(JSON.stringify({ type: "delta", thinking: "", content }));
  await expect(history(page).getByText("Tail marker")).toBeInViewport();
  await expect(jump(page)).toHaveCount(0);
});

test("only offers jump when far from the bottom while idle", async ({
  page,
}) => {
  await openChat(page);
  await history(page).evaluate((node) => {
    node.scrollTop = node.scrollHeight - node.clientHeight - 80;
  });
  await page.waitForTimeout(100);
  await expect(jump(page)).toHaveCount(0);
  await history(page).evaluate((node) => {
    node.scrollTop = 0;
  });
  await expect(jump(page)).toBeVisible();
  await jump(page).click();
  await expect.poll(() => distanceFromBottom(page)).toBeLessThan(16);
  await expect(jump(page)).toHaveCount(0);
});
