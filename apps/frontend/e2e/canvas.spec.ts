import { measure } from "./support/contrast";
import { mockDefaultPersonas } from "./support/personas";
import { expect, test, type Page, type WebSocketRoute } from "./support/test";
import type {
  CanvasVersion,
  Chat,
  ChatModelChoice,
  Message,
} from "../src/lib/client";

/**
 * US-72.2: a fake provider's run writes a canvas item; the user opens it
 * beside the chat, edits it, asks about a selection and restores a version.
 */
const MODEL = "11111111-1111-4111-8111-111111111111";
const CHAT = "77777777-7777-4777-8777-777777777777";
const ITEM = "cccccccc-cccc-4ccc-8ccc-000000000001";
const NEW_ITEM = "cccccccc-cccc-4ccc-8ccc-000000000002";

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
  content: "Draft a launch plan.",
};
const create = {
  id: "create",
  type: "function" as const,
  function: {
    name: "canvas_create",
    arguments: JSON.stringify({ kind: "document", title: "Launch plan" }),
  },
};
const step: Message = {
  id: "88888888-8888-4888-8888-000000000002",
  role: "assistant",
  created_at: 1,
  status: "completed",
  content: "The plan is in the canvas.",
  parent_message_id: userMessage.id,
  tool_calls: [create],
  tool_call_results: [
    {
      tool_call: create,
      content: "{}",
      raw_result: {
        item_id: ITEM,
        version: 1,
        kind: "document",
        language: "",
        title: "Launch plan",
      },
      is_empty: false,
    },
  ],
};

function canvasState() {
  const versions: CanvasVersion[] = [
    {
      number: 1,
      title: "Launch plan",
      author: "agent",
      message_id: userMessage.id,
      size: 0,
      created_at: 1,
      item_id: ITEM,
      kind: "document",
      language: "",
      content: "# Launch\n\nShip on Friday.",
    },
  ];
  const writes: { url: string; body: Record<string, unknown> }[] = [];
  const add = (content: string) => {
    const latest = versions.at(-1)!;
    const next = {
      ...latest,
      number: latest.number + 1,
      author: "user" as const,
      message_id: step.id,
      content,
    };
    versions.push(next);
    return next;
  };
  return { versions, writes, add };
}

async function openChat(page: Page) {
  await mockDefaultPersonas(page);
  const chat: Chat = {
    info: {
      id: CHAT,
      user_id: "test",
      title: "Plan",
      created_at: 0,
      updated_at: 0,
      selected_model_id: MODEL,
      selected_model: model,
      model_revision: 1,
      project_id: null,
    },
    messages: [userMessage],
  };
  const canvas = canvasState();
  const sends: Record<string, unknown>[] = [];
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
  await page.route(`**/api/py/chat/${CHAT}/message`, (route) => {
    const body = route.request().postDataJSON();
    sends.push(body);
    const turn: Message = {
      id: "88888888-8888-4888-8888-000000000003",
      role: "user",
      created_at: 2,
      status: "pending",
      content: body.user_prompt,
      parent_message_id: body.parent_message_id,
    };
    chat.messages = [...chat.messages, turn];
    return route.fulfill({ json: turn });
  });
  await page.route(`**/api/py/chat/${CHAT}/canvas/${ITEM}**`, (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const { versions, writes, add } = canvas;
    if (path.endsWith("/export"))
      return route.fulfill({
        body: "PK-docx",
        headers: {
          "content-type":
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "content-disposition":
            "attachment; filename=\"Launch plan.docx\"; filename*=UTF-8''Launch%20plan.docx",
        },
      });
    if (path.endsWith("/library")) {
      writes.push({ url: path, body: request.postDataJSON() });
      return route.fulfill({ json: { filename: "Launch plan.pdf" } });
    }
    if (request.method() === "POST") {
      const body = request.postDataJSON();
      writes.push({ url: path, body });
      const restored = path.match(/versions\/(\d+)\/restore$/);
      const source = restored
        ? versions[Number(restored[1]) - 1].content
        : body.content;
      return route.fulfill({ json: add(source) });
    }
    const number = path.match(/versions\/(\d+)$/);
    if (number) return route.fulfill({ json: versions[Number(number[1]) - 1] });
    return route.fulfill({
      json: {
        id: ITEM,
        kind: "document",
        language: "",
        versions: versions.map((version) => {
          const summary: Partial<CanvasVersion> = { ...version };
          delete summary.content;
          return summary;
        }),
      },
    });
  });
  const created: Record<string, unknown>[] = [];
  await page.route(`**/api/py/chat/${CHAT}/canvas`, (route) => {
    const request = route.request();
    const latest = canvas.versions.at(-1)!;
    const listed = {
      id: ITEM,
      kind: "document",
      language: "",
      title: latest.title,
      version: latest.number,
      author: latest.author,
      size: 0,
      updated_at: 1,
    };
    if (request.method() === "POST") {
      const body = request.postDataJSON();
      created.push(body);
      return route.fulfill({
        json: {
          ...latest,
          item_id: NEW_ITEM,
          number: 1,
          author: "user",
          title: body.title,
          kind: body.kind,
          language: body.language ?? "",
          content: "",
        },
      });
    }
    return route.fulfill({ json: chat.messages.length > 1 ? [listed] : [] });
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
  await expect(page.getByText("Draft a launch plan.")).toBeVisible({
    timeout: 15_000,
  });
  await expect.poll(() => transport.socket).toBeDefined();
  const socket = transport.socket!;
  // The fake provider's run creates the item, then completes.
  chat.messages = [userMessage, step];
  socket.send(JSON.stringify({ type: "status", is_processing: true }));
  socket.send(JSON.stringify({ type: "start" }));
  socket.send(
    JSON.stringify({ type: "complete", last_messages: [userMessage, step] }),
  );
  return { canvas, sends, created };
}

test("open, edit, ask about a selection and restore a canvas item", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { canvas, sends } = await openChat(page);
  const history = page.getByRole("region", { name: "Conversation history" });
  const cards = history.getByRole("list", { name: "Canvas items" });
  await expect(cards).toContainText("Created · version 1");
  await cards.getByRole("button", { name: "Open canvas Launch plan" }).click();

  const panel = page.getByRole("region", { name: "Canvas: Launch plan" });
  const editor = panel.getByRole("textbox", {
    name: "Launch plan, version 1",
  });
  await expect(editor).toContainText("Ship on Friday.");
  await expect(panel.getByRole("tab", { name: "Edit" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // Contrast: card metadata, editor text and the panel's hint text.
  for (const [name, locator] of [
    ["card-meta", cards.getByText("Created · version 1")],
    ["editor-line", editor.locator(".cm-line").last()],
    ["ask-hint", panel.getByText("Select text in the editor first")],
  ] as const) {
    await locator.evaluate(
      (el, id) => el.setAttribute("data-contrast", id),
      name,
    );
    expect((await measure(page, name)).ratio, name).toBeGreaterThanOrEqual(4.5);
  }

  // The split is resizable from the keyboard.
  const handle = page.getByRole("separator", { name: "Resize canvas" });
  await handle.focus();
  const before = await handle.getAttribute("aria-valuenow");
  await page.keyboard.press("ArrowLeft");
  await expect(handle).not.toHaveAttribute("aria-valuenow", before ?? "");

  // Edit and save a version.
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" Tell support.");
  await panel.getByRole("button", { name: "Save version" }).click();
  await expect.poll(() => canvas.writes.length).toBe(1);
  expect(canvas.writes[0].body).toEqual({
    base_version: 1,
    content: "# Launch\n\nShip on Friday. Tell support.",
  });
  const latest = panel.getByRole("textbox", { name: "Launch plan, version 2" });
  await expect(latest).toContainText("Tell support.");

  // Select the text and ask the agent to change it.
  await latest.click();
  await page.keyboard.press("ControlOrMeta+A");
  await panel.getByRole("button", { name: "Ask about selection" }).click();
  await page
    .getByLabel("What should change in the selected text?")
    .fill("Move it to Monday");
  await page.getByRole("button", { name: "Send to agent" }).click();
  await expect.poll(() => sends.length).toBe(1);
  expect(sends[0].user_prompt).toMatch(/^Move it to Monday\n/);
  expect(sends[0].user_prompt).toContain(`(id ${ITEM}, version 2)`);
  expect(sends[0].user_prompt).toContain(
    "```\n# Launch\n\nShip on Friday. Tell support.\n```",
  );

  // Restore the agent's first version as a new one.
  await panel.getByRole("combobox", { name: "Version" }).click();
  await page.getByRole("option", { name: "Version 1 · Agent" }).click();
  await expect(
    panel.getByRole("textbox", { name: "Launch plan, version 1 (read only)" }),
  ).toContainText("Ship on Friday.");
  await panel.getByRole("button", { name: "Restore this version" }).click();
  await expect.poll(() => canvas.writes.length).toBe(2);
  expect(canvas.writes[1]).toEqual({
    url: `/api/py/chat/${CHAT}/canvas/${ITEM}/versions/1/restore`,
    body: { base_version: 2 },
  });
  await expect(
    panel.getByRole("textbox", { name: "Launch plan, version 3" }),
  ).toContainText("Ship on Friday.");
  // Download the latest version as Word, then save a PDF to the library.
  await panel.getByRole("button", { name: "Download or save" }).click();
  const pending = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Word document (.docx)" })
    .first()
    .click();
  expect((await pending).suggestedFilename()).toBe("Launch plan.docx");
  await panel.getByRole("button", { name: "Download or save" }).click();
  await page.getByRole("menuitem", { name: "PDF (.pdf)" }).last().click();
  await expect.poll(() => canvas.writes.length).toBe(3);
  expect(canvas.writes[2]).toEqual({
    url: `/api/py/chat/${CHAT}/canvas/${ITEM}/versions/3/library`,
    body: { format: "pdf" },
  });
  await page.screenshot({ path: info.outputPath("canvas-panel.png") });

  await panel.getByRole("button", { name: "Close canvas" }).click();
  await expect(panel).toBeHidden();
  await expect(page.getByLabel("Message", { exact: true })).toBeVisible();
});

test("opens as a full-screen sheet on mobile", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openChat(page);
  await page.getByRole("button", { name: "Open canvas Launch plan" }).click();
  const sheet = page.getByRole("dialog", { name: "Canvas" });
  await expect(
    sheet.getByRole("textbox", { name: "Launch plan, version 1" }),
  ).toContainText("Ship on Friday.");
  const box = await sheet.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(389);
  await page.screenshot({ path: info.outputPath("canvas-mobile.png") });
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

test("start a canvas item from the composer's Canvas chip", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { created } = await openChat(page);
  const chip = page.getByRole("button", { name: "Canvas, 1 item" });
  await chip.click();
  const popover = page.locator("[data-slot=popover-content]");
  await expect(
    popover.getByRole("button", { name: /Launch plan/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New canvas item" }).click();
  const dialog = page.getByRole("dialog", { name: "New canvas item" });
  await dialog.getByLabel("Title").fill("Parser");
  await dialog.getByRole("radio", { name: "Code" }).click();
  await dialog.getByLabel("Language").fill("python");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect.poll(() => created.length).toBe(1);
  expect(created[0]).toEqual({
    kind: "code",
    title: "Parser",
    language: "python",
  });
  await expect(dialog).toBeHidden();
});
