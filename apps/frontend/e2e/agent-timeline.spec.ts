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
      title: "Timeline",
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

test.describe("narrow", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("lists tool steps with status, truncated arguments and failures while thinking is hidden", async ({
    page,
  }) => {
    await openChat(page, false);
    const timeline = history(page).getByRole("button", {
      name: "2 tool calls · 1 failed",
      exact: true,
    });
    await expect(timeline).toHaveAttribute("aria-expanded", "false");
    await timeline.click();
    const steps = history(page).getByRole("list", { name: "Agent steps" });
    await expect(steps.getByRole("listitem")).toHaveCount(2);
    await expect(
      history(page).getByText("Hidden reasoning marker"),
    ).toHaveCount(0);

    const searchRow = steps.getByRole("button", { name: /^web_search/ });
    await expect(searchRow).toContainText("Done");
    // The long argument is truncated to one line and never widens the page.
    const box = await searchRow.boundingBox();
    expect(box!.height).toBeLessThan(40);
    expect(
      await history(page).evaluate(
        (node) => node.scrollWidth <= node.clientWidth + 1,
      ),
    ).toBe(true);
    await searchRow.click();
    await expect(
      steps.getByRole("region", { name: "Arguments" }),
    ).toContainText(longQuery);
    await expect(steps.getByRole("region", { name: "Result" })).toContainText(
      "Hipparcos",
    );

    const readRow = steps.getByRole("button", { name: /^read_file/ });
    await expect(readRow).toContainText("Failed");
    await readRow.focus();
    await page.keyboard.press("Enter");
    await expect(steps.getByRole("region", { name: "Error" })).toHaveText(
      "Tool failed with exception: missing",
    );
    expect(
      await history(page).evaluate(
        (node) => node.scrollWidth <= node.clientWidth + 1,
      ),
    ).toBe(true);
  });
});

test("streams reasoning and a running tool, then settles with its duration", async ({
  page,
}) => {
  const { socket, chat } = await openChat(page, true);
  socket.send(JSON.stringify({ type: "status", is_processing: true }));
  socket.send(JSON.stringify({ type: "start" }));
  socket.send(
    JSON.stringify({
      type: "delta",
      thinking: "Live reasoning marker",
      content: "",
    }),
  );
  const live = history(page).getByRole("button", {
    name: "Thinking",
    exact: true,
  });
  await expect(live).toHaveAttribute("aria-expanded", "true");
  await expect(history(page).getByText("Live reasoning marker")).toBeVisible();

  const call = {
    id: "live",
    type: "function" as const,
    function: { name: "web_search", arguments: '{"query":"vega"}' },
  };
  socket.send(JSON.stringify({ type: "tool_call", tool_calls: [call] }));
  const running = history(page).getByRole("button", {
    name: "Running web_search",
    exact: true,
  });
  await expect(running).toBeVisible();
  await expect(
    history(page).getByRole("button", { name: /^web_search.*Running$/ }),
  ).toBeVisible();

  const step: Message = {
    id: "88888888-8888-4888-8888-000000000009",
    role: "assistant",
    created_at: 0,
    status: "completed",
    content: "",
    thinking: "Live reasoning marker",
    parent_message_id: messages[0].id,
    tool_calls: [call],
    tool_call_results: [
      {
        content: "Vega is in Lyra",
        raw_result: { text: "Vega is in Lyra" },
        is_empty: false,
        tool_call: call,
      },
    ],
  };
  // The completion refetches the chat; serve the persisted branch.
  chat.messages = [messages[0], step];
  socket.send(
    JSON.stringify({ type: "complete", last_messages: [messages[0], step] }),
  );
  socket.send(JSON.stringify({ type: "status", is_processing: false }));
  const settled = history(page).getByRole("button", {
    name: "Thinking · 1 tool call",
    exact: true,
  });
  await expect(settled).toHaveAttribute("aria-expanded", "false");
  await settled.click();
  await expect(
    history(page).getByRole("button", { name: /^web_search/ }),
  ).toContainText(/Done · \d+(\.\d)? (ms|s)$/);
});

test("stops the running spinner under reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { socket } = await openChat(page, false);
  socket.send(JSON.stringify({ type: "start" }));
  socket.send(
    JSON.stringify({
      type: "tool_call",
      tool_calls: [
        {
          id: "live",
          type: "function",
          function: { name: "web_search", arguments: "{}" },
        },
      ],
    }),
  );
  const running = history(page).getByRole("button", {
    name: "Running web_search",
    exact: true,
  });
  await expect(running).toHaveAttribute("aria-expanded", "false");
  await expect(running.locator("svg.animate-spin")).toHaveCSS(
    "animation-name",
    "none",
  );
});
