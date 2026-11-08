import AxeBuilder from "@axe-core/playwright";
import { mockDefaultPersonas } from "./support/personas";
import { expect, test, type Page } from "./support/test";
import type {
  Chat,
  ChatCompactionView,
  ChatModelChoice,
  Message,
} from "../src/lib/client";

// US-69.2: context compaction in the chat (ADR-0060), with a small fake window.
const A = "11111111-1111-4111-8111-111111111111";
const C = "77777777-7777-4777-8777-777777777777";
const U1 = "88888888-8888-4888-8888-888888888881";
const R1 = "99999999-9999-4999-8999-999999999991";
const U2 = "88888888-8888-4888-8888-888888888882";
const R2 = "99999999-9999-4999-8999-999999999992";
const U3 = "88888888-8888-4888-8888-888888888883";
const R3 = "99999999-9999-4999-8999-999999999993";
const WINDOW = 1000;

const model: ChatModelChoice = {
  id: A,
  name: "Alpha",
  provider_id: "33333333-3333-4333-8333-333333333333",
  provider_name: "Provider",
  provider_type: "generic_openai",
  available: true,
  supports_vision: false,
  supports_tools: false,
  context_window: WINDOW,
};

const message = (
  id: string,
  role: "user" | "assistant",
  content: string,
  parent?: string,
  status: Message["status"] = "completed",
): Message => ({
  id,
  role,
  content,
  created_at: 0,
  status,
  ...(parent ? { parent_message_id: parent } : {}),
});

const compaction = (
  overrides: Partial<ChatCompactionView> = {},
): ChatCompactionView => ({
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  through_message_id: R1,
  replaced_messages: 2,
  summary: "The user is planning a coastal walk and asked about tide times.",
  model_name: "Alpha",
  trigger: "manual",
  created_at: 1,
  ...overrides,
});

const baseChat = (messages: Message[], usage: number): Chat => ({
  info: {
    id: C,
    user_id: "test",
    title: "Long chat",
    created_at: 0,
    updated_at: 0,
    selected_model_id: A,
    selected_model: model,
    model_revision: 1,
    project_id: null,
    context_model: { id: A, name: "Alpha", context_window: WINDOW },
  },
  messages,
  context_usage: { input_tokens: usage, total_tokens: usage, estimated: true },
  compactions: [],
});

async function mockChat(page: Page, read: () => Chat) {
  await mockDefaultPersonas(page);
  await page.route("**/api/py/chat/models", (route) =>
    route.fulfill({ json: [model] }),
  );
  await page.route(`**/api/py/chat/${C}/files/context`, (route) =>
    route.fulfill({
      json: {
        chat_id: C,
        project_id: null,
        allowed_file_ids: [],
        local_file_ids: [],
        project_file_ids: [],
        unavailable_file_ids: [],
        files: [],
      },
    }),
  );
  await page.route(`**/api/py/chat/${C}`, (route) =>
    route.fulfill({ json: read() }),
  );
}

const meter = (page: Page) =>
  page.getByRole("button", { name: /^Context usage: about/ });

test("compacts on request from the context meter and shows the divider", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const turns = [
    message(U1, "user", "Plan a coastal walk"),
    message(R1, "assistant", "Here is a route along the cliffs.", U1),
    message(U2, "user", "When is low tide?", R1),
    message(R2, "assistant", "Low tide is at 14:10.", U2),
  ];
  let chat = baseChat(turns, 850);
  await mockChat(page, () => chat);

  const commands: string[] = [];
  let finish!: () => void;
  await page.routeWebSocket(`**/api/py/chat/stream/${C}?**`, (socket) => {
    socket.send(JSON.stringify({ type: "status", is_processing: false }));
    socket.onMessage((raw) => {
      const request = JSON.parse(String(raw));
      if (request.type === "ping") {
        socket.send(JSON.stringify({ type: "pong" }));
        return;
      }
      commands.push(request.type);
      if (request.type !== "compact") return;
      socket.send(JSON.stringify({ type: "status", is_processing: true }));
      socket.send(
        JSON.stringify({
          type: "compaction",
          status: "started",
          trigger: "manual",
        }),
      );
      finish = () => {
        const record = compaction();
        chat = { ...baseChat(turns, 300), compactions: [record] };
        socket.send(
          JSON.stringify({
            type: "compaction",
            status: "completed",
            compaction: record,
          }),
        );
        socket.send(JSON.stringify({ type: "status", is_processing: false }));
      };
    });
  });

  await page.goto("/e2e/chat-model-session");
  await expect(meter(page)).toHaveAccessibleName(
    "Context usage: about 85% of the model's context window",
    { timeout: 15_000 },
  );
  await meter(page).click();
  await expect(page.getByText(/about 850 of 1,000 tokens/)).toBeVisible();
  await page.getByRole("button", { name: "Compact now" }).click();

  // The transcript shows the work, and no answer streams for it.
  await expect(
    page.getByRole("status").filter({ hasText: "Compacting conversation…" }),
  ).toBeVisible();
  expect(commands).toContain("compact");
  finish();

  const divider = page.getByRole("button", {
    name: /Conversation compacted: 2 earlier messages summarized/,
  });
  await expect(divider).toBeVisible();
  await expect(page.getByText("Compacting conversation…")).toHaveCount(0);
  await expect(meter(page)).toHaveAccessibleName(
    "Context usage: about 30% of the model's context window",
  );
  // Every message is still shown.
  await expect(
    page.getByText("Here is a route along the cliffs."),
  ).toBeVisible();

  await divider.click();
  await expect(
    page.getByText(/The user is planning a coastal walk/),
  ).toBeVisible();
  await expect(
    page.getByText(/Written by Alpha when you chose Compact now/),
  ).toBeVisible();
  const accessibility = await new AxeBuilder({ page })
    .include('[data-slot="compaction-divider"]')
    .analyze();
  expect(accessibility.violations).toEqual([]);
  expect(errors).toEqual([]);
});

test("shows an automatic compaction before the reply streams", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const turns = [
    message(U1, "user", "Plan a coastal walk"),
    message(R1, "assistant", "Here is a route along the cliffs.", U1),
    message(U2, "user", "When is low tide?", R1),
    message(R2, "assistant", "Low tide is at 14:10.", U2),
    message(U3, "user", "And high tide?", R2, "pending"),
  ];
  let chat = baseChat(turns, 900);
  await mockChat(page, () => chat);

  let answer!: () => void;
  await page.routeWebSocket(`**/api/py/chat/stream/${C}?**`, (socket) => {
    // The server resumes the pending turn on connect and compacts first.
    socket.send(JSON.stringify({ type: "status", is_processing: true }));
    socket.send(
      JSON.stringify({
        type: "compaction",
        status: "started",
        trigger: "automatic",
      }),
    );
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type === "ping")
        socket.send(JSON.stringify({ type: "pong" }));
    });
    answer = () => {
      const record = compaction({ trigger: "automatic" });
      socket.send(
        JSON.stringify({
          type: "compaction",
          status: "completed",
          compaction: record,
        }),
      );
      socket.send(JSON.stringify({ type: "start" }));
      const reply = message(R3, "assistant", "High tide is at 20:25.", U3);
      chat = {
        ...baseChat(
          [...turns.slice(0, -1), { ...turns[4], status: "completed" }, reply],
          400,
        ),
        compactions: [record],
      };
      socket.send(
        JSON.stringify({
          type: "complete",
          last_messages: chat.messages.slice(4),
        }),
      );
      socket.send(JSON.stringify({ type: "status", is_processing: false }));
    };
  });

  await page.goto("/e2e/chat-model-session");
  await expect(
    page.getByRole("status").filter({ hasText: "Compacting conversation…" }),
  ).toBeVisible({ timeout: 15_000 });
  answer();
  await expect(page.getByText("High tide is at 20:25.")).toBeVisible();
  await expect(page.getByText("Compacting conversation…")).toHaveCount(0);
  const divider = page.getByRole("button", {
    name: /Conversation compacted: 2 earlier messages summarized/,
  });
  await divider.click();
  await expect(page.getByText(/Written by Alpha automatically/)).toBeVisible();
  expect(errors).toEqual([]);
});
