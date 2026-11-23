import AxeBuilder from "@axe-core/playwright";
import { mockLearningModes } from "./support/learning-modes";
import { expect, test, type Page, type WebSocketRoute } from "./support/test";
import type {
  Chat,
  ChatModelChoice,
  MemoryProposal,
  Message,
} from "../src/lib/client";

/**
 * US-93.4: a run offers to remember something; the card shows the text and
 * where it would be saved, and nothing is saved until the person clicks.
 */
const MODEL = "11111111-1111-4111-8111-111111111111";
const CHAT = "77777777-7777-4777-8777-777777777777";
const PROPOSAL = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const MEMORY = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";

const model: ChatModelChoice = {
  id: MODEL,
  name: "Main model",
  provider_id: "33333333-3333-4333-8333-333333333333",
  provider_name: "Provider",
  provider_type: "generic_openai",
  available: true,
  supports_tools: true,
  context_window: 4096,
};
const userMessage: Message = {
  id: "88888888-8888-4888-8888-000000000001",
  role: "user",
  created_at: 0,
  status: "completed",
  content: "I learn best from worked examples.",
};
const call = {
  id: "propose",
  type: "function" as const,
  function: {
    name: "propose_memory",
    arguments: JSON.stringify({ kind: "user", category: "learning" }),
  },
};
const reply: Message = {
  id: "88888888-8888-4888-8888-000000000002",
  role: "assistant",
  created_at: 1,
  status: "completed",
  content: "Here is a worked example. I've offered to remember how you learn.",
  parent_message_id: userMessage.id,
  tool_calls: [call],
  tool_call_results: [
    {
      tool_call: call,
      content: "{}",
      raw_result: { proposal_id: PROPOSAL, status: "pending" },
      is_empty: false,
    },
  ],
};

async function openChat(page: Page) {
  await mockLearningModes(page);
  const chat: Chat = {
    info: {
      id: CHAT,
      user_id: "test",
      title: "Learning",
      created_at: 0,
      updated_at: 0,
      selected_model_id: MODEL,
      selected_model: model,
      model_revision: 1,
      project_id: null,
    },
    messages: [userMessage],
  };
  const proposal: MemoryProposal = {
    id: PROPOSAL,
    chat_id: CHAT,
    message_id: userMessage.id,
    execution_id: "99999999-9999-4999-8999-000000000001",
    kind: "user",
    project_id: null,
    text: "Learns best from worked examples",
    category: "learning",
    sensitive: false,
    status: "pending",
    memory_id: null,
    created_at: 1,
    decided_at: null,
  };
  const saves: Record<string, unknown>[] = [];
  await page.route("**/api/py/chat/models", (route) =>
    route.fulfill({ json: [model] }),
  );
  await page.route(`**/api/py/chat/${CHAT}/files/context`, (route) =>
    route.fulfill({
      json: {
        chat_id: CHAT,
        project_id: null,
        allowed_file_ids: [],
        unavailable_file_ids: [],
        files: [],
      },
    }),
  );
  await page.route(`**/api/py/chat/${CHAT}`, (route) =>
    route.fulfill({ json: chat }),
  );
  await page.route(`**/api/py/chat/${CHAT}/canvas`, (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route(
    `**/api/py/users/me/memory-proposals/${PROPOSAL}**`,
    (route) => {
      const request = route.request();
      if (request.url().endsWith("/save")) {
        const body = request.postDataJSON();
        saves.push(body);
        Object.assign(proposal, {
          status: "saved",
          memory_id: MEMORY,
          text: body.text,
          decided_at: 2,
        });
        return route.fulfill({ status: 201, json: { id: MEMORY } });
      }
      return route.fulfill({ json: proposal });
    },
  );
  const transport: { socket?: WebSocketRoute } = {};
  await page.routeWebSocket(`**/api/py/chat/stream/${CHAT}?**`, (socket) => {
    transport.socket = socket;
    socket.send(JSON.stringify({ type: "status", is_processing: false }));
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type === "ping")
        socket.send(JSON.stringify({ type: "pong" }));
    });
  });
  await page.goto("/e2e/chat-model-session");
  await expect(page.getByText(userMessage.content!)).toBeVisible({
    timeout: 15_000,
  });
  await expect.poll(() => transport.socket).toBeDefined();
  const socket = transport.socket!;
  chat.messages = [userMessage, reply];
  socket.send(JSON.stringify({ type: "status", is_processing: true }));
  socket.send(JSON.stringify({ type: "start" }));
  socket.send(
    JSON.stringify({ type: "complete", last_messages: [userMessage, reply] }),
  );
  return { saves };
}

for (const width of [1280, 320]) {
  test(`edit and save a proposed memory at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const { saves } = await openChat(page);
    const card = page.getByRole("region", { name: "Remember this?" });
    await expect(card).toContainText("Learns best from worked examples");
    await expect(card).toContainText("Saves to: You, in every chat");
    expect(saves).toEqual([]);

    const scan = await new AxeBuilder({ page })
      .include('[aria-label="Memory proposals"]')
      .analyze();
    expect(scan.violations).toEqual([]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);

    await card.getByRole("button", { name: "Edit" }).click();
    const text = card.getByLabel("Memory");
    await text.fill("Learns best from worked examples, then practice");
    await card.getByRole("button", { name: "Save memory" }).click();
    await expect.poll(() => saves.length).toBe(1);
    expect(saves[0]).toEqual({
      text: "Learns best from worked examples, then practice",
      category: "learning",
      sensitive: false,
    });
    const list = page.getByRole("list", { name: "Memory proposals" });
    await expect(
      list.getByRole("link", { name: "View memory" }),
    ).toHaveAttribute(
      "href",
      `/settings?t=user&setting=your-asterism&memory=${MEMORY}`,
    );
  });
}
