import { defaultPersonaProvenance } from "../src/test/personas";
import { mockDefaultPersonas } from "./support/personas";
import { expect, test } from "./support/test";
import type { Chat, ChatModelChoice, Message } from "../src/lib/client";

test.beforeEach(async ({ page }) => {
  await mockDefaultPersonas(page);
});

const A = "11111111-1111-4111-8111-111111111111";
const C = "77777777-7777-4777-8777-777777777777";
const U = "88888888-8888-4888-8888-888888888888";
const R = "99999999-9999-4999-8999-999999999999";
const model: ChatModelChoice = {
  id: A,
  name: "Alpha",
  provider_id: "33333333-3333-4333-8333-333333333333",
  provider_name: "Provider",
  provider_type: "generic_openai",
  available: true,
  supports_vision: false,
  supports_tools: false,
  context_window: 4096,
};
const explainBack = {
  id: "explain_back" as const,
  name: "Explain-back",
  version: 2,
};
const execution = (request: string) => ({
  persona: defaultPersonaProvenance,
  learning_mode: explainBack,
  id: "44444444-4444-4444-8444-444444444444",
  request_message_id: request,
  model_revision: 1,
  model,
  configuration: {
    id: "66666666-6666-4666-8666-666666666666",
    name: "Main",
    description: "",
    system_prompt: "",
    config_revision: 1,
  },
});

const feedback = `### What you got right
Plants use **sunlight** and **water**, and oxygen is released.

### What was missing or wrong
- You left out where the carbon in the food comes from.
- Plants do not "breathe out" oxygen the way animals exhale; it is a by-product.

### Follow-up questions
1. Which gas do plants take in from the air?
2. Where is the captured energy stored?`;

test("renders Explain-back feedback as sections while streaming and after completion", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let chat: Chat = {
    info: {
      id: C,
      user_id: "test",
      title: "Photosynthesis",
      created_at: 0,
      updated_at: 0,
      selected_model_id: A,
      selected_model: model,
      model_revision: 1,
      project_id: null,
      learning_mode: "explain_back",
      learning_mode_revision: 1,
    },
    messages: [
      {
        id: U,
        role: "user",
        created_at: 0,
        status: "completed",
        content: "I want to check that I understand photosynthesis.",
        learning_mode: explainBack,
      },
      {
        id: R,
        role: "assistant",
        created_at: 0,
        status: "completed",
        content: "Great. Explain photosynthesis to me in your own words.",
        parent_message_id: U,
        learning_mode: explainBack,
        execution: execution(U),
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
        local_file_ids: [],
        project_file_ids: [],
        unavailable_file_ids: [],
        files: [],
      },
    }),
  );
  await page.route(`**/api/py/chat/${C}`, (route) =>
    route.fulfill({ json: chat }),
  );
  await page.route(`**/api/py/chat/${C}/message`, (route) => {
    const body = route.request().postDataJSON();
    const turn: Message = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
      role: "user",
      created_at: 1,
      status: "completed",
      content: body.user_prompt,
      parent_message_id: body.parent_message_id,
      learning_mode: explainBack,
    };
    chat = { ...chat, messages: [...chat.messages, turn] };
    return route.fulfill({ json: turn });
  });
  let finish = () => {};
  await page.routeWebSocket(`**/api/py/chat/stream/${C}?**`, (socket) => {
    socket.send(JSON.stringify({ type: "status", is_processing: false }));
    socket.onMessage((raw) => {
      const request = JSON.parse(String(raw));
      if (request.type === "ping")
        socket.send(JSON.stringify({ type: "pong" }));
      if (request.type !== "resume") return;
      const turn = chat.messages.at(-1)!;
      socket.send(JSON.stringify({ type: "status", is_processing: true }));
      socket.send(
        JSON.stringify({ type: "start", execution: execution(turn.id) }),
      );
      // Stream only the first section until the test releases the rest.
      socket.send(
        JSON.stringify({
          type: "delta",
          content: feedback.slice(0, feedback.indexOf("### What was")),
          thinking: "",
        }),
      );
      finish = () => {
        const reply: Message = {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001",
          role: "assistant",
          created_at: 2,
          status: "completed",
          content: feedback,
          parent_message_id: turn.id,
          learning_mode: explainBack,
          execution: execution(turn.id),
        };
        chat = { ...chat, messages: [...chat.messages, reply] };
        socket.send(
          JSON.stringify({ type: "complete", last_messages: [turn, reply] }),
        );
        socket.send(JSON.stringify({ type: "status", is_processing: false }));
      };
    });
  });

  await page.goto("/e2e/chat-model-session");
  const opener = page.getByText(
    "Great. Explain photosynthesis to me in your own words.",
  );
  await expect(opener).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole("group", { name: "Explanation feedback" }),
  ).toHaveCount(0);

  await page
    .getByLabel("Message", { exact: true })
    .fill(
      "Plants take in sunlight and water to make food and breathe out oxygen.",
    );
  await page.keyboard.press("Enter");

  const live = page.getByRole("group", { name: "Explanation feedback" });
  await expect(live).toBeVisible();
  await expect(live.getByRole("heading", { level: 3 })).toHaveText([
    "What you got right",
  ]);

  finish();
  const done = page.getByRole("group", { name: "Explanation feedback" });
  await expect(done.getByRole("heading", { level: 3 })).toHaveText([
    "What you got right",
    "What was missing or wrong",
    "Follow-up questions",
  ]);
  await expect(
    page.getByRole("region", { name: "What was missing or wrong" }),
  ).toContainText("where the carbon in the food comes from");
  await expect(done).not.toContainText("###");
  expect(errors).toEqual([]);
});
