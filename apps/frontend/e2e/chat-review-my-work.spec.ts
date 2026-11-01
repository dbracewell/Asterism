import { defaultPersonaProvenance } from "../src/test/personas";
import { mockDefaultPersonas } from "./support/personas";
import { expect, test } from "./support/test";
import type {
  Chat,
  ChatModelChoice,
  HintLevel,
  Message,
} from "../src/lib/client";

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
const D = "44444444-4444-4444-8444-000000000001";
const review = (hint_level: HintLevel) => ({
  id: "review" as const,
  name: "Review my work",
  version: 2,
  hint_level,
});
const attempt = {
  id: "10000000-0000-4000-8000-000000000001",
  filename: "average.py",
  original_name: "average.py",
  size: 64,
  mime_type: "text/x-python",
  kind: "document",
  content_status: "ready",
  content_error: null,
  created_at: 0,
  updated_at: 0,
};
const attemptReference = {
  file_id: attempt.id,
  filename: attempt.filename,
  name: attempt.original_name,
  mime_type: attempt.mime_type,
  size: attempt.size,
  kind: "document" as const,
  status: "ready" as const,
  available: true,
};

test("reviews an attached attempt and confirms before showing a corrected solution", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let chat: Chat = {
    info: {
      id: C,
      user_id: "test",
      title: "Review",
      created_at: 0,
      updated_at: 0,
      selected_model_id: A,
      selected_model: model,
      model_revision: 1,
      project_id: null,
      learning_mode: "review",
      learning_mode_revision: 1,
      hint_level: "none",
    },
    messages: [
      {
        id: U,
        role: "user",
        created_at: 0,
        status: "completed",
        content: "Can you review my averaging function?",
        learning_mode: review("none"),
      },
      {
        id: R,
        role: "assistant",
        created_at: 0,
        status: "completed",
        content: "Sure. Paste or attach your attempt.",
        parent_message_id: U,
        execution: {
          persona: defaultPersonaProvenance,
          learning_mode: review("none"),
          id: "44444444-4444-4444-8444-444444444444",
          request_message_id: U,
          model_revision: 1,
          model,
          configuration: {
            id: "66666666-6666-4666-8666-666666666666",
            name: "Main",
            description: "",
            system_prompt: "",
            config_revision: 1,
          },
        },
      },
    ],
  };
  let staged: string[] = [];
  const sends: Record<string, unknown>[] = [];
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
  await page.route("**/api/py/chat/drafts", (route) =>
    route.fulfill({
      json: {
        id: D,
        chat_id: C,
        file_ids: staged,
        unavailable_file_ids: [],
        expires_at: 9999999999,
      },
    }),
  );
  await page.route("**/api/py/chat/drafts/*", (route) =>
    route.fulfill({
      json: { id: D, file_ids: staged, unavailable_file_ids: [] },
    }),
  );
  await page.route("**/api/py/chat/drafts/*/uploads", (route) => {
    staged = [attempt.id];
    return route.fulfill({ json: { files: [attempt] } });
  });
  await page.route(`**/api/py/chat/${C}`, (route) =>
    route.fulfill({ json: chat }),
  );
  await page.route(`**/api/py/chat/${C}/message`, (route) => {
    const body = route.request().postDataJSON();
    sends.push(body);
    const level = (body.hint?.level ?? chat.info.hint_level) as HintLevel;
    const turn: Message = {
      id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(sends.length).padStart(12, "0")}`,
      role: "user",
      created_at: sends.length,
      status: "completed",
      content: body.user_prompt,
      parent_message_id: body.parent_message_id,
      learning_mode: review(level),
      ...(body.draft_id ? { files: [attemptReference] } : {}),
    };
    chat = {
      info: { ...chat.info, hint_level: level },
      messages: [...chat.messages, turn],
    };
    return route.fulfill({ json: turn });
  });
  await page.routeWebSocket(`**/api/py/chat/stream/${C}?**`, (socket) => {
    socket.send(JSON.stringify({ type: "status", is_processing: false }));
    socket.onMessage((raw) => {
      const request = JSON.parse(String(raw));
      if (request.type === "ping")
        socket.send(JSON.stringify({ type: "pong" }));
      if (request.type !== "resume") return;
      const turn = chat.messages.at(-1)!;
      const reply: Message = {
        id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(sends.length).padStart(12, "0")}`,
        role: "assistant",
        created_at: sends.length,
        status: "completed",
        content: `Review reply ${sends.length}`,
        parent_message_id: turn.id,
      };
      chat = { ...chat, messages: [...chat.messages, reply] };
      socket.send(
        JSON.stringify({ type: "complete", last_messages: [turn, reply] }),
      );
      socket.send(JSON.stringify({ type: "status", is_processing: false }));
    });
  });
  await page.goto("/e2e/chat-model-session");
  const controls = page.getByRole("group", { name: "Hint controls" });
  await expect(controls).toContainText("Help level: Feedback only", {
    timeout: 15_000,
  });
  await expect(controls.getByRole("button")).toHaveText(["Show solution"]);

  // A plain attempt with an attachment never asks for a reveal.
  await page.getByLabel("Choose attachments").setInputFiles({
    name: "average.py",
    mimeType: "text/x-python",
    buffer: Buffer.from(
      "def average(values):\n    return sum(values) / len(values)\n",
    ),
  });
  await page.getByLabel("Message", { exact: true }).fill("Here is my attempt.");
  await expect(page.getByLabel("Send message")).toBeEnabled();
  await page.getByLabel("Send message").click();
  await expect.poll(() => sends.length).toBe(1);
  expect(sends[0]).toMatchObject({
    user_prompt: "Here is my attempt.",
    draft_id: D,
    parent_message_id: R,
  });
  expect(sends[0]).not.toHaveProperty("hint");
  await expect(page.getByText("Review reply 1")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Download average.py" }),
  ).toBeVisible();
  await expect(controls).toContainText("Help level: Feedback only");

  await controls.getByRole("button", { name: "Show solution" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Show a corrected solution?");
  await dialog.getByRole("button", { name: "Keep trying" }).click();
  expect(sends).toHaveLength(1);
  await controls.getByRole("button", { name: "Show solution" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Show solution" })
    .click();
  await expect.poll(() => sends.length).toBe(2);
  expect(sends[1]).toMatchObject({
    user_prompt: "Show me a corrected solution.",
    hint: { level: "answer", confirm_reveal: true },
  });
  await expect(controls).toContainText("Help level: Solution shown");
  await expect(
    page.locator("[data-learning-mode][data-hint-level=answer]"),
  ).toContainText("Review my work · Solution shown");
  await expect(
    controls.getByRole("button", { name: "Show solution" }),
  ).toBeDisabled();
  await expect(
    controls.getByRole("button", { name: "New attempt" }),
  ).toBeEnabled();
  expect(errors).toEqual([]);
});
