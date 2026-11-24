import AxeBuilder from "@axe-core/playwright";
import { mockLearningModes } from "./support/learning-modes";
import { expect, test, type Page, type WebSocketRoute } from "./support/test";
import type {
  Chat,
  ChatModelChoice,
  Message,
  StudyProposal,
} from "../src/lib/client";

/**
 * US-98.4 (EPIC-98): asked for flashcards in a project chat, a run drafts a
 * deck; the card previews it, the person edits and saves it, and the saved
 * card links to the new deck in Study. Nothing is saved until they click.
 */
const MODEL = "11111111-1111-4111-8111-111111111111";
const CHAT = "77777777-7777-4777-8777-777777777777";
const PROPOSAL = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const DECK = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";
const PROJECT = "cccccccc-cccc-4ccc-8ccc-000000000001";

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
  content: "Make me flashcards on cell parts.",
};
const call = {
  id: "propose",
  type: "function" as const,
  function: {
    name: "propose_deck",
    arguments: "{}",
  },
};
const reply: Message = {
  id: "88888888-8888-4888-8888-000000000002",
  role: "assistant",
  created_at: 1,
  status: "completed",
  content: "I drafted a deck of flashcards on cell parts for you to review.",
  parent_message_id: userMessage.id,
  tool_calls: [call],
  tool_call_results: [
    {
      tool_call: call,
      content: "{}",
      raw_result: {
        proposal_id: PROPOSAL,
        kind: "deck",
        items: 2,
        status: "pending",
      },
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
      title: "Biology",
      created_at: 0,
      updated_at: 0,
      selected_model_id: MODEL,
      selected_model: model,
      model_revision: 1,
      project_id: PROJECT,
    },
    messages: [userMessage],
  };
  const proposal: StudyProposal = {
    id: PROPOSAL,
    project_id: PROJECT,
    chat_id: CHAT,
    message_id: userMessage.id,
    kind: "deck",
    status: "pending",
    deck: {
      title: "Cell parts",
      description: "",
      cards: [
        {
          front: "Powerhouse of the cell?",
          back: "Mitochondria",
          file_ids: [],
        },
        { front: "Control centre of the cell?", back: "Nucleus", file_ids: [] },
      ],
    },
    quiz: null,
    saved_id: null,
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
        project_id: PROJECT,
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
  await page.route(`**/api/py/study/proposals/${PROPOSAL}**`, (route) => {
    const request = route.request();
    if (request.url().endsWith("/save")) {
      const body = request.postDataJSON();
      saves.push(body);
      Object.assign(proposal, {
        status: "saved",
        saved_id: DECK,
        deck: body.deck,
        decided_at: 2,
      });
      return route.fulfill({ status: 201, json: proposal });
    }
    return route.fulfill({ json: proposal });
  });
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
  test(`review, edit and save a drafted deck at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const { saves } = await openChat(page);
    const card = page.getByRole("region", {
      name: "Draft flashcard deck: Cell parts",
    });
    await expect(card).toContainText("Mitochondria");
    await expect(card).toContainText(
      "Nothing is added to Study until you save it.",
    );
    expect(saves).toEqual([]);

    const scan = await new AxeBuilder({ page })
      .include('[aria-label="Study drafts"]')
      .analyze();
    expect(scan.violations).toEqual([]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);

    await card.getByRole("button", { name: "Edit" }).click();
    await card.getByRole("button", { name: "Remove card 2" }).click();
    await card.getByLabel("Back").fill("The mitochondria");
    await card.getByRole("button", { name: "Save to Study" }).click();
    await expect.poll(() => saves.length).toBe(1);
    expect(saves[0]).toEqual({
      deck: {
        title: "Cell parts",
        description: "",
        cards: [
          {
            front: "Powerhouse of the cell?",
            back: "The mitochondria",
            file_ids: [],
          },
        ],
      },
    });
    const saved = page.getByRole("list", { name: "Study drafts" });
    await expect(saved).toContainText("Saved to Study.");
    await expect(
      saved.getByRole("link", { name: "Open deck" }),
    ).toHaveAttribute("href", `/projects/${PROJECT}/study/${DECK}`);
  });
}
