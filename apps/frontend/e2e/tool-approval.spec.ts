import { mockDefaultPersonas } from "./support/personas";
import { expect, test, type Page, type WebSocketRoute } from "./support/test";
import type { Chat, ChatModelChoice, Message } from "../src/lib/client";

const M = "11111111-1111-4111-8111-111111111111";
const C = "77777777-7777-4777-8777-777777777777";
const longQuery = "constellation".repeat(60);

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

const search = {
  id: "search",
  type: "function" as const,
  function: {
    name: "web_search",
    arguments: JSON.stringify({ query: longQuery }),
  },
};
const read = {
  id: "read",
  type: "function" as const,
  function: { name: "read_file", arguments: '{"path":"notes.md"}' },
};

const messages: Message[] = [
  {
    id: "88888888-8888-4888-8888-000000000001",
    role: "user",
    created_at: 0,
    status: "completed",
    content: "Find star catalogues.",
  },
  {
    id: "88888888-8888-4888-8888-000000000002",
    role: "assistant",
    created_at: 0,
    status: "completed",
    content: "",
    thinking: "Hidden reasoning marker",
    parent_message_id: "88888888-8888-4888-8888-000000000001",
    tool_calls: [search, read],
    tool_call_results: [
      {
        content: '{"hits":["Hipparcos","Gaia"]}',
        raw_result: { hits: ["Hipparcos", "Gaia"] },
        is_empty: false,
        tool_call: search,
      },
      {
        content: '{"error":"Tool failed with exception: missing"}',
        raw_result: { error: "Tool failed with exception: missing" },
        is_empty: true,
        tool_call: read,
      },
    ],
  },
  {
    id: "88888888-8888-4888-8888-000000000003",
    role: "assistant",
    created_at: 0,
    status: "completed",
    content: "Hipparcos and Gaia are the main catalogues.",
    parent_message_id: "88888888-8888-4888-8888-000000000002",
  },
];

async function openChat(page: Page, thinking: boolean) {
  await mockDefaultPersonas(page);
  const chat: Chat = {
    info: {
      id: C,
      user_id: "test",
      title: "Approvals",
      created_at: 0,
      updated_at: 0,
      selected_model_id: M,
      selected_model: model,
      model_revision: 1,
      project_id: null,
    },
    messages: [...messages],
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
  await page.goto(`/e2e/chat-model-session?thinking=${thinking}`);
  await expect(page.getByText("main catalogues")).toBeVisible({
    timeout: 15_000,
  });
  await expect.poll(() => transport.socket).toBeDefined();
  return { socket: transport.socket!, chat };
}

const history = (page: Page) =>
  page.getByRole("region", { name: "Conversation history" });

test("approves and denies repeated tool requests from focus-managed cards", async ({
  page,
}) => {
  const { socket } = await openChat(page, false);
  const sent: { type: string; tool_id?: string; approved?: boolean }[] = [];
  socket.onMessage((raw) => {
    const packet = JSON.parse(String(raw));
    if (packet.type === "tool_approval") {
      sent.push(packet);
      socket.send(JSON.stringify({ type: "tool_update", id: packet.tool_id }));
    } else if (packet.type === "ping") {
      socket.send(JSON.stringify({ type: "pong" }));
    }
  });
  socket.send(JSON.stringify({ type: "status", is_processing: true }));
  socket.send(JSON.stringify({ type: "start" }));
  const request = (id: string, name: string, args: string) =>
    socket.send(
      JSON.stringify({
        type: "tool_permission_request",
        id,
        name,
        arguments: args,
      }),
    );
  request("w", "write_file", '{"path":"<b>notes.md</b>"}');
  request("w", "write_file", '{"path":"<b>notes.md</b>"}');
  request("s", "web_search", JSON.stringify({ query: longQuery }));

  const approvals = history(page).getByRole("region", {
    name: "Tool approvals",
  });
  await expect(approvals.getByRole("group")).toHaveCount(2);
  const writeCard = approvals.getByRole("group", { name: "Allow write_file?" });
  await expect(writeCard).toBeFocused();
  await expect(writeCard).toContainText("May make changes");
  await expect(
    writeCard.getByRole("region", { name: "Arguments" }),
  ).toContainText('"path": "<b>notes.md</b>"');
  expect(
    await history(page).evaluate(
      (node) => node.scrollWidth <= node.clientWidth + 1,
    ),
  ).toBe(true);

  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(
    writeCard.getByRole("button", { name: "Approve write_file" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");

  const searchCard = approvals.getByRole("group", {
    name: "Allow web_search?",
  });
  await expect(searchCard).toBeFocused();
  await expect(writeCard).toHaveCount(0);
  await searchCard.getByRole("button", { name: "Deny web_search" }).click();
  await expect(approvals).toHaveCount(0);
  expect(sent).toEqual([
    { type: "tool_approval", tool_id: "w", approved: true },
    { type: "tool_approval", tool_id: "s", approved: false },
  ]);

  // A later request in the same turn gets its own card and focus.
  request("w2", "write_file", "{}");
  const again = approvals.getByRole("group", { name: "Allow write_file?" });
  await expect(again).toBeFocused();
  await expect(again).toContainText("No arguments.");
});

test("leaves focus in the composer when a request arrives while typing", async ({
  page,
}) => {
  const { socket } = await openChat(page, false);
  const composer = page.getByRole("combobox", { name: "Message" });
  await composer.click();
  await composer.pressSequentially("draft");
  socket.send(JSON.stringify({ type: "start" }));
  socket.send(
    JSON.stringify({
      type: "tool_permission_request",
      id: "c",
      name: "calculator",
      arguments: '{"expression":"1+1"}',
    }),
  );
  await expect(
    history(page).getByRole("group", { name: "Allow calculator?" }),
  ).toBeVisible();
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue("draft");
});
