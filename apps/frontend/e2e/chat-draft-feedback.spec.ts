import { defaultPersonaProvenance } from "../src/test/personas";
import { mockDefaultPersonas } from "./support/personas";
import { expect, test } from "./support/test";
import type {
  Chat,
  ChatModelChoice,
  Message,
  RubricDocument,
} from "../src/lib/client";

test.beforeEach(async ({ page }) => {
  await mockDefaultPersonas(page);
});

const A = "11111111-1111-4111-8111-111111111111";
const C = "77777777-7777-4777-8777-777777777777";
const U = "88888888-8888-4888-8888-888888888888";
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
const mode = {
  id: "draft_feedback" as const,
  name: "Draft feedback",
  version: 1,
};
const essay: RubricDocument = {
  name: "Argumentative essay",
  description: "Essays that take a position.",
  levels: ["Exemplary", "Proficient", "Developing", "Beginning"],
  criteria: [
    {
      label: "Thesis",
      description: "",
      descriptors: ["Insightful.", "Clear.", "Vague.", "Missing."],
    },
    {
      label: "Evidence",
      description: "",
      descriptors: ["Strong.", "Relevant.", "Thin.", "None."],
    },
  ],
};
const provenance = {
  source: "bundled" as const,
  id: "argumentative-essay",
  revision: 1,
  name: essay.name,
  levels: essay.levels,
  criteria: essay.criteria.map((criterion) => criterion.label),
};
const execution = (request: string) => ({
  persona: defaultPersonaProvenance,
  learning_mode: mode,
  rubric: provenance,
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

const feedback = `### Thesis
Estimated level: Developing

> Uniforms should be required.

The claim is clear but broad. Say which schools and why.

### Evidence
Estimated level: Beginning

> a study said

Name the study and what it found.

### Overall
The position is easy to follow. Start by finding a source for the bullying claim.`;

test("sends the chosen rubric and renders feedback by criterion", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let chat: Chat = {
    info: {
      id: C,
      user_id: "test",
      title: "Essay feedback",
      created_at: 0,
      updated_at: 0,
      selected_model_id: A,
      selected_model: model,
      model_revision: 1,
      project_id: null,
      learning_mode: "draft_feedback",
      learning_mode_revision: 1,
    },
    messages: [],
  };
  await page.route("**/api/py/chat/models", (route) =>
    route.fulfill({ json: [model] }),
  );
  await page.route(/\/api\/py\/rubrics\/bundled(?:\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        version: 1,
        items: [
          {
            id: "argumentative-essay",
            revision: 1,
            name: essay.name,
            description: essay.description,
            document: essay,
          },
        ],
      },
    }),
  );
  await page.route(/\/api\/py\/rubrics\/(?:\?.*)?$/, (route) =>
    route.fulfill({ json: { items: [], total: 0, page: 1, page_size: 100 } }),
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
  const sent: Record<string, unknown>[] = [];
  await page.route(`**/api/py/chat/${C}/message`, (route) => {
    const body = route.request().postDataJSON();
    sent.push(body);
    const turn: Message = {
      id: U,
      role: "user",
      created_at: 1,
      status: "completed",
      content: body.user_prompt,
      parent_message_id: body.parent_message_id,
      learning_mode: mode,
      rubric: { ...body.rubric, revision: 1, document: essay, available: true },
    };
    chat = { ...chat, messages: [...chat.messages, turn] };
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
      socket.send(JSON.stringify({ type: "status", is_processing: true }));
      socket.send(
        JSON.stringify({ type: "start", execution: execution(turn.id) }),
      );
      socket.send(
        JSON.stringify({ type: "delta", content: feedback, thinking: "" }),
      );
      const reply: Message = {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001",
        role: "assistant",
        created_at: 2,
        status: "completed",
        content: feedback,
        parent_message_id: turn.id,
        learning_mode: mode,
        execution: execution(turn.id),
      };
      chat = { ...chat, messages: [...chat.messages, reply] };
      socket.send(
        JSON.stringify({ type: "complete", last_messages: [turn, reply] }),
      );
      socket.send(JSON.stringify({ type: "status", is_processing: false }));
    });
  });

  await page.goto("/e2e/chat-model-session");
  const picker = page.getByRole("combobox", { name: "Rubric" });
  await expect(picker).toBeEnabled({ timeout: 15_000 });
  await expect(picker).toHaveText("No rubric");
  await picker.click();
  await page.getByRole("option", { name: "Argumentative essay" }).click();
  await expect(picker).toHaveText("Argumentative essay");

  await page
    .getByLabel("Message", { exact: true })
    .fill("Uniforms should be required. Also, a study said bullying drops.");
  await page.keyboard.press("Enter");

  const reply = page.getByRole("group", {
    name: "Feedback against Argumentative essay",
  });
  await expect(reply.getByRole("heading", { level: 3 })).toHaveText([
    "Thesis",
    "Evidence",
    "Overall",
  ]);
  expect(sent[0].rubric).toEqual({
    source: "bundled",
    id: "argumentative-essay",
  });
  await expect(page.getByText("Rubric: Argumentative essay")).toBeVisible();
  const thesis = page.getByRole("region", { name: "Thesis" });
  await expect(thesis).toContainText("Developing");
  await expect(thesis.getByTitle(/Estimated level 2 of 4/)).toBeVisible();
  await expect(reply).not.toContainText("###");
  // The rubric stays chosen for the next draft.
  await expect(picker).toHaveText("Argumentative essay");
  expect(errors).toEqual([]);
});

test("opens the draft with comments pinned to passages and resolves one", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const R = "bbbbbbbb-bbbb-4bbb-8bbb-000000000002";
  const draft =
    "Uniforms should be required. Also, a study said bullying drops.";
  const chat: Chat = {
    info: {
      id: C,
      user_id: "test",
      title: "Essay feedback",
      created_at: 0,
      updated_at: 0,
      selected_model_id: A,
      selected_model: model,
      model_revision: 1,
      project_id: null,
      learning_mode: "draft_feedback",
      learning_mode_revision: 1,
    },
    messages: [
      {
        id: U,
        role: "user",
        created_at: 0,
        status: "completed",
        content: draft,
        learning_mode: mode,
        rubric: { ...provenance, document: essay, available: true },
      },
      {
        id: R,
        role: "assistant",
        created_at: 1,
        status: "completed",
        content: feedback,
        parent_message_id: U,
        learning_mode: mode,
        execution: execution(U),
        draft_comment_summary: { total: 2, resolved: 0 },
      },
    ],
  };
  await page.route("**/api/py/chat/models", (route) =>
    route.fulfill({ json: [model] }),
  );
  await page.route(/\/api\/py\/rubrics\/.*/, (route) =>
    route.fulfill({
      json: route.request().url().includes("bundled")
        ? { version: 1, items: [] }
        : { items: [], total: 0, page: 1, page_size: 100 },
    }),
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
  let resolved = false;
  await page.route(`**/api/py/chat/${C}/messages/${R}/draft-review`, (route) =>
    route.fulfill({
      json: {
        documents: [
          {
            id: "message",
            kind: "message",
            name: "Your message",
            available: true,
            text: draft,
          },
        ],
        comments: [
          {
            id: "c1",
            criterion: "Thesis",
            level: "Developing",
            quote: "Uniforms should be required.",
            note: "Clear but broad.",
            resolved,
            anchor: { document_id: "message", start: 0, end: 28 },
          },
          {
            id: "c2",
            criterion: "Evidence",
            level: "Beginning",
            quote: "Uniforms cure everything.",
            note: "Not in the draft.",
            resolved: false,
            anchor: null,
          },
        ],
      },
    }),
  );
  const updates: unknown[] = [];
  await page.route(
    `**/api/py/chat/${C}/messages/${R}/draft-review/comments/c1`,
    (route) => {
      updates.push(route.request().postDataJSON());
      resolved = true;
      return route.fulfill({ json: { total: 2, resolved: 1 } });
    },
  );
  await page.routeWebSocket(`**/api/py/chat/stream/${C}?**`, (socket) => {
    socket.send(JSON.stringify({ type: "status", is_processing: false }));
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type === "ping")
        socket.send(JSON.stringify({ type: "pong" }));
    });
  });

  await page.goto("/e2e/chat-model-session");
  const button = page.getByRole("button", {
    name: /Review draft with comments/,
  });
  await expect(button).toBeVisible({ timeout: 15_000 });
  await expect(button).toContainText("2 comments");
  await button.click();
  const dialog = page.getByRole("dialog", { name: "Your draft with comments" });
  const passage = dialog.locator("mark");
  await expect(passage).toHaveText("Uniforms should be required.");
  await dialog.getByRole("button", { name: /^Thesis/ }).click();
  await expect(passage).toHaveAttribute("data-selected", "true");
  await expect(
    dialog.getByRole("region", { name: "Not found in your draft" }),
  ).toContainText("Uniforms cure everything.");
  await dialog
    .getByRole("listitem")
    .filter({ hasText: "Clear but broad." })
    .getByRole("checkbox", { name: "Resolved" })
    .click();
  // Resolved passages keep a dotted underline, even while selected.
  await expect(passage).toHaveClass(/decoration-dotted/);
  expect(updates).toEqual([{ resolved: true }]);
  expect(errors).toEqual([]);
});
