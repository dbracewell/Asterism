import { mockDefaultPersonas } from "./support/personas";
import { expect, test, type Page, type WebSocketRoute } from "./support/test";
import type { Chat, ChatModelChoice, Message } from "../src/lib/client";

const C = "77777777-7777-4777-8777-777777777777";
const M = "11111111-1111-4111-8111-111111111111";
const model: ChatModelChoice = {
  id: M,
  name: "Layout model",
  provider_id: M,
  provider_name: "Synthetic provider",
  provider_type: "generic_openai",
  available: true,
  context_window: 8192,
  supports_tools: true,
};
const paragraphs = (label: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${label} paragraph ${i}`).join(
    "\n\n",
  );
const uuid = (index: number) =>
  `88888888-8888-4888-8888-${String(index).padStart(12, "0")}`;
const message = (
  id: number,
  role: Message["role"],
  content: string,
  status: Message["status"] = "completed",
) => ({ id: uuid(id), role, content, status, created_at: 0 }) as Message;

async function fixtures(page: Page) {
  await mockDefaultPersonas(page);
  const chat: Chat = {
    info: {
      id: C,
      user_id: "test",
      title: "Synthetic follow",
      created_at: 0,
      updated_at: 0,
      selected_model_id: M,
      model_revision: 1,
      project_id: null,
    },
    messages: [
      message(0, "user", "First question"),
      message(1, "assistant", paragraphs("Earlier", 30)),
    ],
  };
  const transport: { socket?: WebSocketRoute } = {};
  await page.route("**/api/py/chat/models", (route) =>
    route.fulfill({ json: [model] }),
  );
  await page.route(`**/api/py/chat/${C}`, (route) =>
    route.fulfill({ json: chat }),
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
  await page.route(`**/api/py/chat/${C}/message`, async (route) => {
    const body = route.request().postDataJSON();
    chat.messages.push(
      message(chat.messages.length, "user", body.user_prompt, "pending"),
    );
    await route.fulfill({ json: chat.messages.at(-1) });
  });
  await page.routeWebSocket(`**/api/py/chat/stream/${C}?**`, (socket) => {
    transport.socket = socket;
    socket.send(JSON.stringify({ type: "status", is_processing: false }));
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type === "ping")
        socket.send(JSON.stringify({ type: "pong" }));
    });
  });
  return { chat, transport };
}

const distanceFromBottom = (page: Page) =>
  page
    .getByRole("region", { name: "Conversation history" })
    .evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight);

async function send(page: Page, text: string) {
  await page.getByLabel("Message", { exact: true }).fill(text);
  await page.keyboard.press("Enter");
}

test("follows each sent turn and its finished reply to the bottom", async ({
  page,
}) => {
  const { chat, transport } = await fixtures(page);
  await page.setViewportSize({ width: 900, height: 600 });
  await page.goto("/e2e/chat-reachability");
  await expect.poll(() => !!transport.socket).toBe(true);
  const socket = transport.socket!;
  await expect(page.getByLabel("Message", { exact: true })).toBeEnabled();
  await expect.poll(() => distanceFromBottom(page)).toBeLessThan(2);

  for (const turn of [1, 2, 3]) {
    const prompt = `Question ${turn}\n\n${paragraphs("Asked", 6)}`;
    await send(page, prompt);
    await expect(page.getByText(`Question ${turn}`)).toBeInViewport();
    await expect.poll(() => distanceFromBottom(page)).toBeLessThan(2);

    socket.send(JSON.stringify({ type: "start" }));
    const reply = paragraphs(`Reply ${turn}`, 20);
    for (let length = 40; length < reply.length; length += 40) {
      socket.send(
        JSON.stringify({
          type: "delta",
          thinking: "",
          content: reply.slice(0, length),
        }),
      );
      await page.waitForTimeout(60);
    }
    await expect.poll(() => distanceFromBottom(page)).toBeLessThan(2);

    const last = chat.messages.at(-1)!;
    last.status = "completed";
    const final = message(chat.messages.length, "assistant", reply);
    chat.messages.push(final);
    socket.send(JSON.stringify({ type: "complete", last_messages: [final] }));
    socket.send(JSON.stringify({ type: "status", is_processing: false }));
    await expect(
      page.getByText(`Reply ${turn} paragraph 19`, { exact: true }),
    ).toBeInViewport();
    await expect.poll(() => distanceFromBottom(page)).toBeLessThan(2);
    await expect(page.getByLabel("Message", { exact: true })).toBeEnabled();
  }
});

test("scrolling up during a reply stays put until the next send", async ({
  page,
}) => {
  const { transport } = await fixtures(page);
  await page.setViewportSize({ width: 900, height: 600 });
  await page.goto("/e2e/chat-reachability");
  await expect.poll(() => !!transport.socket).toBe(true);
  const socket = transport.socket!;
  await expect(page.getByLabel("Message", { exact: true })).toBeEnabled();
  const history = page.getByRole("region", { name: "Conversation history" });

  await send(page, "Question");
  socket.send(JSON.stringify({ type: "start" }));
  socket.send(
    JSON.stringify({
      type: "delta",
      thinking: "",
      content: paragraphs("Reply", 5),
    }),
  );
  await expect(
    page.getByText("Reply paragraph 4", { exact: true }),
  ).toBeInViewport();
  await history.hover({ position: { x: 16, y: 16 } });
  await page.mouse.wheel(0, -100000);
  await expect.poll(() => history.evaluate((node) => node.scrollTop)).toBe(0);

  socket.send(
    JSON.stringify({
      type: "delta",
      thinking: "",
      content: paragraphs("Reply", 25),
    }),
  );
  await expect(
    page.getByText("Reply paragraph 24", { exact: true }),
  ).toBeAttached();
  expect(await history.evaluate((node) => node.scrollTop)).toBe(0);
});
