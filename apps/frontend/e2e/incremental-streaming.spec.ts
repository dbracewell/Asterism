import { mockLearningModes } from "./support/learning-modes";
import { expect, test, type Page, type WebSocketRoute } from "./support/test";
import type { Chat, ChatModelChoice } from "../src/lib/client";

// US-120.3: the browser rebuilds replies from numbered increments (ADR-0084).

const M = "11111111-1111-4111-8111-111111111111";
const C = "77777777-7777-4777-8777-777777777777";

const model: ChatModelChoice = {
  id: M,
  name: "Alpha",
  provider_id: "33333333-3333-4333-8333-333333333333",
  provider_name: "Provider",
  provider_type: "generic_openai",
  available: true,
  supports_tools: true,
  context_window: 4096,
};

const history = (page: Page) =>
  page.getByRole("region", { name: "Conversation history" });

function delta(seq: number, mode: "append" | "replace", content: string) {
  return JSON.stringify({
    type: "delta",
    stream: "step-1",
    seq,
    mode,
    content,
    thinking: "",
  });
}

type Transport = { sockets: WebSocketRoute[]; resyncs: number };

async function openChat(page: Page): Promise<Transport> {
  await mockLearningModes(page);
  const chat: Chat = {
    info: {
      id: C,
      user_id: "test",
      title: "Increments",
      created_at: 0,
      updated_at: 0,
      selected_model_id: M,
      selected_model: model,
      model_revision: 1,
      project_id: null,
    },
    messages: [
      {
        id: "88888888-8888-4888-8888-000000000001",
        role: "user",
        created_at: 0,
        status: "completed",
        content: "Why are there tides?",
      },
    ],
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
  const transport: Transport = { sockets: [], resyncs: 0 };
  await page.routeWebSocket(`**/api/py/chat/stream/${C}?**`, (socket) => {
    transport.sockets.push(socket);
    socket.send(JSON.stringify({ type: "status", is_processing: true }));
    socket.onMessage((raw) => {
      const command = JSON.parse(String(raw));
      if (command.type === "ping")
        socket.send(JSON.stringify({ type: "pong" }));
      if (command.type === "resync") transport.resyncs += 1;
    });
  });
  await page.goto("/e2e/chat-model-session");
  await expect(history(page).getByText("Why are there tides?")).toBeVisible({
    timeout: 15_000,
  });
  await expect.poll(() => transport.sockets.length).toBe(1);
  return transport;
}

test("appends new text in order and repairs a gap with the text so far", async ({
  page,
}) => {
  const transport = await openChat(page);
  const socket = transport.sockets[0];
  socket.send(JSON.stringify({ type: "start" }));
  socket.send(delta(1, "append", "Tides follow "));
  socket.send(delta(2, "append", "the moon."));
  await expect(history(page).getByText("Tides follow the moon.")).toBeVisible();

  // Packet 3 was dropped: the page asks for the text so far, once.
  socket.send(delta(4, "append", " Lost"));
  socket.send(delta(5, "append", " words."));
  await expect.poll(() => transport.resyncs).toBe(1);
  await expect(history(page).getByText("Lost")).toHaveCount(0);

  socket.send(
    delta(5, "replace", "Tides follow the moon. And the sun. Lost words."),
  );
  await expect(
    history(page).getByText("Tides follow the moon. And the sun. Lost words."),
  ).toBeVisible();
  expect(transport.resyncs).toBe(1);
});

test("picks a reply back up after reconnecting mid-reply", async ({ page }) => {
  const transport = await openChat(page);
  const first = transport.sockets[0];
  first.send(JSON.stringify({ type: "start" }));
  first.send(delta(1, "append", "The moon pulls "));
  await expect(history(page).getByText("The moon pulls")).toBeVisible();

  await first.close();
  await expect
    .poll(() => transport.sockets.length, { timeout: 15_000 })
    .toBe(2);

  // The server starts a joining tab from the text so far.
  const second = transport.sockets[1];
  second.send(delta(3, "replace", "The moon pulls the sea"));
  second.send(delta(4, "append", " toward it."));
  await expect(
    history(page).getByText("The moon pulls the sea toward it."),
  ).toBeVisible();
  expect(transport.resyncs).toBe(0);
});
