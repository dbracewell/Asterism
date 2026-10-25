import { defaultPersonaProvenance } from "../src/test/personas";
import { mockDefaultPersonas } from "./support/personas";
import { expect, test } from "./support/test";
import type {
  Chat,
  ChatModelChoice,
  Message,
  MessageExecution,
} from "../src/lib/client";
test.beforeEach(async ({ page }) => {
  await mockDefaultPersonas(page);
});

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "77777777-7777-4777-8777-777777777777";
const U = "88888888-8888-4888-8888-888888888888";
const R = "99999999-9999-4999-8999-999999999999";
const models: ChatModelChoice[] = [
  {
    id: A,
    name: "Alpha",
    provider_id: "33333333-3333-4333-8333-333333333333",
    provider_name: "Provider",
    available: true,
    supports_vision: false,
    supports_tools: false,
    context_window: 4096,
  },
  {
    id: B,
    name: "Beta",
    provider_id: "33333333-3333-4333-8333-333333333333",
    provider_name: "Provider",
    available: true,
    supports_vision: true,
    supports_tools: true,
    context_window: 8192,
  },
];
const execution = (model: ChatModelChoice): MessageExecution => ({
  persona: defaultPersonaProvenance,
  id: "44444444-4444-4444-8444-444444444444",
  request_message_id: U,
  model_revision: model.id === A ? 1 : 2,
  model,
  configuration: {
    id: "66666666-6666-4666-8666-666666666666",
    name: "Main",
    description: "",
    system_prompt: "Be precise",
    config_revision: 1,
  },
});
const original: Message = {
  id: R,
  role: "assistant",
  created_at: 0,
  status: "completed",
  content: "Original Alpha answer",
  parent_message_id: U,
  execution: execution(models[0]),
};

test("reopens a saved model, switches and regenerates through the real chat component, and restores original provenance", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let chat: Chat = {
    info: {
      id: C,
      user_id: "test",
      title: "Model verification",
      created_at: 0,
      updated_at: 0,
      selected_model_id: A,
      selected_model: models[0],
      model_revision: 1,
      project_id: null,
    },
    messages: [
      {
        id: U,
        role: "user",
        created_at: 0,
        status: "completed",
        content: "Explain this",
      },
      original,
    ],
  };
  const changes: unknown[] = [];
  let settingsWrites = 0;
  await page.route("**/api/py/settings/user/main-agent", (route) => {
    settingsWrites++;
    return route.fulfill({ status: 500 });
  });
  await page.route("**/api/py/chat/models", (route) =>
    route.fulfill({ json: models }),
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
  let finishModelChange!: () => void;
  const modelChangeGate = new Promise<void>((resolve) => {
    finishModelChange = resolve;
  });
  await page.route(`**/api/py/chat/${C}/model`, async (route) => {
    const body = route.request().postDataJSON();
    changes.push(body);
    await modelChangeGate;
    chat = {
      ...chat,
      info: {
        ...chat.info,
        selected_model_id: B,
        selected_model: models[1],
        model_revision: 2,
      },
    };
    return route.fulfill({ json: chat.info });
  });
  await page.route(`**/api/py/chat/${C}/message/${U}`, (route) => {
    chat = {
      ...chat,
      messages: [
        chat.messages[0],
        {
          ...original,
          sibling_count: 2,
          current_sibling_index: 1,
          next_sibling_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        },
      ],
    };
    return route.fulfill({ json: chat.messages[0] });
  });
  let finish: (() => void) | undefined;
  let regeneratedWith: string | undefined;
  await page.routeWebSocket(`**/api/py/chat/stream/${C}?**`, (socket) => {
    socket.send(JSON.stringify({ type: "status", is_processing: false }));
    socket.onMessage((raw) => {
      const request = JSON.parse(String(raw));
      if (request.type === "ping") {
        socket.send(JSON.stringify({ type: "pong" }));
        return;
      }
      if (request.type !== "regenerate") return;
      regeneratedWith = chat.info.selected_model_id ?? undefined;
      socket.send(JSON.stringify({ type: "status", is_processing: true }));
      finish = () => {
        const response: Message = {
          ...original,
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          content: "Regenerated Beta answer",
          execution: execution(models[1]),
          sibling_count: 2,
          current_sibling_index: 2,
          previous_sibling_id: R,
        };
        chat = { ...chat, messages: [chat.messages[0], response] };
        socket.send(JSON.stringify({ type: "regenerate", parent_id: U }));
        socket.send(
          JSON.stringify({
            type: "complete",
            last_messages: [chat.messages[0], response],
          }),
        );
        socket.send(JSON.stringify({ type: "status", is_processing: false }));
      };
    });
  });
  await page.goto("/e2e/chat-model-session");
  await expect(page.getByLabel("Chat model")).toContainText("Alpha", {
    timeout: 15_000,
  });
  await expect(page.getByLabel("Executed model")).toContainText("Alpha");
  await page.getByLabel("Chat model").click();
  await page.getByRole("option", { name: "Beta (Provider)" }).click();
  await expect(page.getByLabel("Chat model")).toBeDisabled();
  await expect(page.getByLabel("Message", { exact: true })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Regenerate response" }),
  ).toBeDisabled();
  await expect(page.getByLabel("Executed model")).toContainText("Alpha");
  finishModelChange();
  await expect(page.getByLabel("Chat model")).toContainText("Beta");
  await expect(page.getByText("Images supported")).toBeVisible();
  await expect(page.getByText("8,192 token context")).toBeVisible();
  await expect(page.getByLabel("Executed model")).toContainText("Alpha");
  expect(changes).toEqual([{ model_id: B, expected_model_revision: 1 }]);
  await page.reload();
  await expect(page.getByLabel("Chat model")).toContainText("Beta");
  await expect(page.getByLabel("Executed model")).toContainText("Alpha");
  await expect(
    page.getByText("General chats never delegate to sub-agents."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Regenerate response" }).click();
  await expect.poll(() => regeneratedWith).toBe(B);
  await expect(page.getByLabel("Chat model")).toBeDisabled();
  finish!();
  await expect(page.getByText("Regenerated Beta answer")).toBeVisible();
  await expect(page.getByLabel("Executed model")).toContainText("Beta");
  await page.getByRole("button", { name: "Previous response version" }).click();
  await expect(page.getByText("Original Alpha answer")).toBeVisible();
  await expect(page.getByLabel("Executed model")).toContainText("Alpha");
  await expect(page.getByLabel("Chat model")).toContainText("Beta");
  await expect(page.getByLabel("Executed model")).toHaveText(
    "Alpha · Provider · configuration 1",
  );
  expect(settingsWrites).toBe(0);
  await page.screenshot({
    path: "test-results/chat-model-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/chat-model-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(errors).toEqual([]);
});

test("chooses a draft model explicitly and forwards it when starting a chat", async ({
  page,
}) => {
  await page.route("**/api/py/chat/models", (route) =>
    route.fulfill({ json: models }),
  );
  let created: Record<string, unknown> | undefined;
  await page.route("**/api/py/chat/", (route) => {
    if (route.request().method() !== "POST")
      return route.fulfill({
        json: { chats: [], total: 0, page: 1, page_size: 20 },
      });
    created = route.request().postDataJSON();
    return route.fulfill({ json: { info: { id: C }, messages: [] } });
  });
  await page.goto("/e2e/chat-model-session?draft=true");
  await page.getByLabel("Chat model").click();
  await page.getByRole("option", { name: "Beta (Provider)" }).click();
  await page
    .getByLabel("Message", { exact: true })
    .fill("Use my selected model");
  await page.getByLabel("Send message").click();
  await expect.poll(() => created?.model_id).toBe(B);
  expect(created?.project_id).toBeNull();
  expect(created).not.toHaveProperty("agent_id");
  await expect(page).toHaveURL(/sign-in/);
});

test("shows capacity overload and recovers on a bounded reconnect without posting a duplicate turn", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let chat: Chat = {
    info: {
      id: C,
      user_id: "test",
      title: "Capacity verification",
      created_at: 0,
      updated_at: 0,
      selected_model_id: A,
      selected_model: models[0],
      model_revision: 1,
      project_id: null,
    },
    messages: [
      {
        id: U,
        role: "user",
        created_at: 0,
        status: "pending",
        content: "Resume my saved request",
      },
    ],
  };
  let writes = 0;
  await page.route(`**/api/py/chat/${C}/message`, (route) => {
    writes++;
    return route.fulfill({ status: 500 });
  });
  await page.route("**/api/py/chat/models", (route) =>
    route.fulfill({ json: models }),
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
  let attempts = 0;
  await page.routeWebSocket(`**/api/py/chat/stream/${C}?**`, (socket) => {
    attempts++;
    if (attempts === 1) {
      socket.send(
        JSON.stringify({
          type: "error",
          code: 503,
          error_code: "chat_capacity",
          retryable: true,
          content: "Chat capacity is full. Retry shortly.",
        }),
      );
      socket.close({ code: 1013, reason: "Retry shortly" });
      return;
    }
    chat = {
      ...chat,
      messages: [
        { ...chat.messages[0], status: "completed" },
        { ...original, content: "Recovered saved response" },
      ],
    };
    socket.send(
      JSON.stringify({ type: "complete", last_messages: chat.messages }),
    );
    socket.send(JSON.stringify({ type: "status", is_processing: false }));
  });
  await page.goto("/e2e/chat-model-session");
  await expect(
    page.getByRole("alert").filter({ hasText: "Chat capacity is full" }),
  ).toBeVisible();
  await expect(page.getByText("Recovered saved response")).toBeVisible();
  expect(attempts).toBe(2);
  expect(writes).toBe(0);
  expect(errors).toEqual([]);
});
