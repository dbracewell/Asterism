import { mockDefaultPersonas } from "./support/personas";
import { expect, test, type Page, type WebSocketRoute } from "./support/test";
import type {
  Chat,
  ChatModelChoice,
  DelegationRecord,
  Message,
} from "../src/lib/client";

const M = "11111111-1111-4111-8111-111111111111";
const C = "77777777-7777-4777-8777-777777777777";
const LEAD = "99999999-9999-4999-8999-000000000001";
const CHILD = "99999999-9999-4999-8999-000000000002";

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
  id: "child-search",
  type: "function" as const,
  function: { name: "web_search", arguments: '{"query":"star catalogues"}' },
};
const delegate = {
  id: "delegate",
  type: "function" as const,
  function: {
    name: "sub_agent",
    arguments: JSON.stringify({ agent_id: "researcher", prompt: "Find them" }),
  },
};

const delegations: DelegationRecord[] = [
  {
    execution_id: LEAD,
    parent_execution_id: null,
    sub_agent_id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
    name: "Researcher",
    model_name: "Gamma",
    depth: 1,
    status: "completed",
    started_at_ms: 1_000,
    ended_at_ms: 13_000,
    tool_calls: [search],
    tool_results: [
      {
        tool_call: search,
        content: "Hipparcos and Gaia",
        raw_result: { text: "Hipparcos and Gaia" },
        is_empty: false,
      },
    ],
    output: "Hipparcos and **Gaia** are the main catalogues.",
    error: null,
  },
  {
    execution_id: CHILD,
    parent_execution_id: LEAD,
    sub_agent_id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000002",
    name: "Checker",
    model_name: "Delta",
    depth: 2,
    status: "error",
    started_at_ms: 4_000,
    ended_at_ms: 9_000,
    tool_calls: [],
    tool_results: [],
    output: "",
    error: "Provider timed out",
  },
];

const user: Message = {
  id: "88888888-8888-4888-8888-000000000001",
  role: "user",
  created_at: 0,
  status: "completed",
  content: "Find star catalogues.",
};
const step: Message = {
  id: "88888888-8888-4888-8888-000000000002",
  role: "assistant",
  created_at: 0,
  status: "completed",
  content: "",
  parent_message_id: user.id,
  tool_calls: [delegate],
  tool_call_results: [
    {
      tool_call: delegate,
      content: "Hipparcos and Gaia are the main catalogues.",
      raw_result: "Hipparcos and Gaia are the main catalogues.",
      is_empty: false,
    },
  ],
  delegations,
};
const answer: Message = {
  id: "88888888-8888-4888-8888-000000000003",
  role: "assistant",
  created_at: 0,
  status: "completed",
  content: "The researcher found Hipparcos and Gaia.",
  parent_message_id: step.id,
};

async function openChat(page: Page, messages: Message[]) {
  await mockDefaultPersonas(page);
  const chat: Chat = {
    info: {
      id: C,
      user_id: "test",
      title: "Delegation",
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
  await expect(page.getByText("Find star catalogues.")).toBeVisible({
    timeout: 15_000,
  });
  await expect.poll(() => transport.socket).toBeDefined();
  return { socket: transport.socket!, chat };
}

const history = (page: Page) =>
  page.getByRole("region", { name: "Conversation history" });
const summary = (page: Page) =>
  history(page).getByRole("button", {
    name: "2 agents · 12.0 s · 1 tool · 1 failed",
    exact: true,
  });
const graph = (page: Page) =>
  history(page).getByRole("img", { name: /^Delegation graph/ });

test("history renders delegations collapsed and expands to each agent", async ({
  page,
}) => {
  await openChat(page, [user, step, answer]);
  await expect(summary(page)).toHaveAttribute("aria-expanded", "false");
  await expect(graph(page)).toHaveCount(0);
  await expect(history(page).getByText("Provider timed out")).toHaveCount(0);

  await summary(page).focus();
  await page.keyboard.press("Enter");
  await expect(summary(page)).toHaveAttribute("aria-expanded", "true");
  await expect(graph(page)).toHaveAccessibleName(
    "Delegation graph: main agent and 2 sub-agents, 1 failed",
  );
  const lead = history(page).getByTestId(`delegation-${LEAD}`);
  await expect(lead).toContainText("Researcher");
  await expect(lead).toContainText("Gamma");
  await expect(lead).toContainText("Done · 12.0 s");
  // Output renders as Markdown, never raw HTML.
  await expect(lead.locator("strong")).toHaveText("Gaia");
  await lead.getByRole("button", { name: "1 tool call", exact: true }).click();
  const searchRow = lead.getByRole("button", { name: /^web_search/ });
  await expect(searchRow).toContainText("Done");
  await searchRow.click();
  await expect(lead.getByRole("region", { name: "Result" })).toContainText(
    "Hipparcos and Gaia",
  );
  const child = history(page).getByTestId(`delegation-${CHILD}`);
  await expect(child).toContainText("Depth 2");
  await expect(child).toContainText("Failed · 5.0 s");
  await expect(child).toContainText("Provider timed out");
  await expect(history(page).getByRole("alert")).toHaveCount(0);

  await page.reload();
  await expect(summary(page)).toHaveAttribute("aria-expanded", "false");
  await expect(graph(page)).toHaveCount(0);
});

test("a live run's graph collapses into the summary once its step persists", async ({
  page,
}) => {
  const { socket, chat } = await openChat(page, [user]);
  socket.send(JSON.stringify({ type: "status", is_processing: true }));
  socket.send(JSON.stringify({ type: "start" }));
  socket.send(
    JSON.stringify({
      type: "sub_agent",
      execution_id: LEAD,
      parent_execution_id: null,
      sub_agent_id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
      sub_agent_name: "Researcher",
      model_id: M,
      model_name: "Gamma",
      depth: 1,
      event: { type: "start" },
    }),
  );
  const live = history(page).getByRole("region", {
    name: "Sub-agent activity",
  });
  await expect(live.getByRole("img", { name: /1 running/ })).toBeVisible();
  await expect(summary(page)).toHaveCount(0);

  chat.messages = [user, step];
  socket.send(
    JSON.stringify({ type: "complete", last_messages: [user, step] }),
  );
  await expect(live).toHaveCount(0);
  await expect(summary(page)).toHaveAttribute("aria-expanded", "false");
});

for (const theme of ["atlas", "night-atlas", "dracula"]) {
  for (const viewport of [
    { name: "desktop", width: 1100, height: 1000 },
    { name: "mobile", width: 390, height: 1000 },
  ]) {
    test(`${theme}: expanded delegation summary at ${viewport.name}`, async ({
      page,
      context,
    }) => {
      await context.addCookies([
        {
          name: "asterism-custom-theme-name",
          value: theme,
          url: "http://localhost:3100",
        },
      ]);
      await page.setViewportSize(viewport);
      await openChat(page, [user, step, answer]);
      await summary(page).click();
      await expect(graph(page)).toBeVisible();
      await expect(
        history(page).locator('[data-slot="delegation-summary"]'),
      ).toHaveScreenshot(`delegation-summary-${theme}-${viewport.name}.png`);
    });
  }
}
