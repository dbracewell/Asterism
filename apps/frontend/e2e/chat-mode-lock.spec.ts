import { defaultPersonaProvenance } from "../src/test/personas";
import { mockDefaultPersonas } from "./support/personas";
import { expect, test } from "./support/test";
import type {
  Chat,
  ChatInfo,
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
const tutor = (hint_level: HintLevel) => ({
  id: "tutor" as const,
  name: "Tutor",
  version: 2,
  hint_level,
});

test("locks the mode from the header and makes leaving it or revealing wait", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let chat: Chat = {
    info: {
      id: C,
      user_id: "test",
      title: "Algebra practice",
      created_at: 0,
      updated_at: 0,
      selected_model_id: A,
      selected_model: model,
      model_revision: 1,
      project_id: null,
      learning_mode: "tutor",
      learning_mode_revision: 1,
      learning_mode_locked: false,
      hint_level: "none",
    },
    messages: [
      {
        id: U,
        role: "user",
        created_at: 0,
        status: "completed",
        content: "Solve 3x + 7 = 22",
        learning_mode: tutor("none"),
      },
      {
        id: R,
        role: "assistant",
        created_at: 0,
        status: "completed",
        content: "What could you do to both sides?",
        parent_message_id: U,
        execution: {
          persona: defaultPersonaProvenance,
          learning_mode: tutor("none"),
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
  const modeUpdates: Record<string, unknown>[] = [];
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
  await page.route(`**/api/py/chat/${C}`, (route) =>
    route.fulfill({ json: chat }),
  );
  await page.route(`**/api/py/chat/${C}/learning-mode`, (route) => {
    const body = route.request().postDataJSON();
    modeUpdates.push(body);
    const standard = body.learning_mode === "standard";
    const info: ChatInfo = {
      ...chat.info,
      learning_mode: body.learning_mode,
      learning_mode_locked: standard
        ? false
        : (body.locked ?? chat.info.learning_mode_locked),
      learning_mode_revision: (chat.info.learning_mode_revision ?? 1) + 1,
    };
    chat = { ...chat, info };
    return route.fulfill({ json: info });
  });
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
      learning_mode: tutor(level),
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
        content: `Tutor reply ${sends.length}`,
        parent_message_id: turn.id,
      };
      chat = { ...chat, messages: [...chat.messages, reply] };
      socket.send(
        JSON.stringify({ type: "complete", last_messages: [turn, reply] }),
      );
      socket.send(JSON.stringify({ type: "status", is_processing: false }));
    });
  });
  await page.clock.install();
  await page.goto("/e2e/chat-model-session?header=true");

  // Lock from the header.
  const header = page.locator("header");
  await header
    .getByRole("button", { name: "Lock Tutor mode" })
    .click({ timeout: 15_000 });
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Lock mode" })
    .click();
  await expect.poll(() => modeUpdates.length).toBe(1);
  expect(modeUpdates[0]).toEqual({
    learning_mode: "tutor",
    expected_learning_mode_revision: 1,
    locked: true,
  });
  await expect(
    header.getByRole("button", { name: "Tutor mode locked. Unlock" }),
  ).toContainText("Tutor locked");

  // A locked reveal waits before it can be confirmed.
  const controls = page.getByRole("group", { name: "Hint controls" });
  await controls.getByRole("button", { name: "Show answer" }).click();
  let dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("You locked this chat's mode");
  const reveal = dialog.getByRole("button", { name: "Show answer" });
  await expect(reveal).toBeDisabled();
  await page.clock.fastForward(5_000);
  await expect(reveal).toBeEnabled();
  await reveal.click();
  await expect.poll(() => sends.length).toBe(1);
  expect(sends[0]).toMatchObject({
    user_prompt: "Show me the answer.",
    hint: { level: "answer", confirm_reveal: true, override_lock: true },
  });
  await expect(page.getByText("Tutor reply 1")).toBeVisible();

  // Switching to Standard waits too, and releases the lock.
  await page.getByRole("combobox", { name: "Learning mode" }).click();
  await page.getByRole("option", { name: "Standard" }).click();
  dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Leave Tutor mode?");
  const leave = dialog.getByRole("button", { name: "Switch to Standard" });
  await expect(leave).toBeDisabled();
  await page.clock.fastForward(5_000);
  await leave.click();
  await expect.poll(() => modeUpdates.length).toBe(2);
  expect(modeUpdates[1]).toEqual({
    learning_mode: "standard",
    expected_learning_mode_revision: 2,
    override_lock: true,
  });
  await expect(header.getByRole("button", { name: /lock/i })).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Learning mode" }),
  ).toContainText("Standard");
  expect(errors).toEqual([]);
});
