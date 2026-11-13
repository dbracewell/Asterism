import { mockDefaultPersonas } from "./support/personas";
import { expect, test, type Page, type WebSocketRoute } from "./support/test";
import type { Chat, ChatModelChoice, Message } from "../src/lib/client";

/**
 * US-76.5: a user chooses Create image, watches progress, sees the saved image
 * inline, opens it and asks for more like it; a run can be stopped. The
 * backend is a fake provider run over a mocked socket; generation itself is
 * covered by the backend tests (test_image_generation.py).
 */
const MODEL = "11111111-1111-4111-8111-111111111111";
const CHAT = "77777777-7777-4777-8777-777777777777";
const IMAGE = "99999999-9999-4999-8999-000000000001";
// A 1×1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const model: ChatModelChoice = {
  id: MODEL,
  name: "Main model",
  provider_id: "33333333-3333-4333-8333-333333333333",
  provider_name: "Provider",
  provider_type: "generic_openai",
  available: true,
  // Create image works without tool support: the image is made directly.
  supports_tools: false,
  context_window: 4096,
};
const hello: Message[] = [
  {
    id: "88888888-8888-4888-8888-000000000001",
    role: "user",
    created_at: 0,
    status: "completed",
    content: "Hello there.",
  },
  {
    id: "88888888-8888-4888-8888-000000000002",
    role: "assistant",
    created_at: 1,
    status: "completed",
    content: "Hello! What shall we make?",
    parent_message_id: "88888888-8888-4888-8888-000000000001",
  },
];

async function openChat(page: Page, available = true) {
  await mockDefaultPersonas(page);
  const chat: Chat = {
    info: {
      id: CHAT,
      user_id: "test",
      title: "Pictures",
      created_at: 0,
      updated_at: 0,
      selected_model_id: MODEL,
      selected_model: model,
      model_revision: 1,
      project_id: null,
    },
    messages: [...hello],
  };
  const sends: Record<string, unknown>[] = [];
  const received: Record<string, unknown>[] = [];
  await page.route("**/api/py/chat/models", (route) =>
    route.fulfill({ json: [model] }),
  );
  await page.route("**/api/py/image-generation/availability", (route) =>
    route.fulfill({
      json: available
        ? { available: true, reason: "" }
        : { available: false, reason: "Image generation is turned off" },
    }),
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
  await page.route(`**/api/py/chat/${CHAT}/files/${IMAGE}`, (route) =>
    route.fulfill({ body: PNG, contentType: "image/png" }),
  );
  await page.route(`**/api/py/chat/${CHAT}/canvas`, (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route(`**/api/py/chat/${CHAT}`, (route) =>
    route.fulfill({ json: chat }),
  );
  await page.route(`**/api/py/chat/${CHAT}/message`, (route) => {
    const body = route.request().postDataJSON();
    sends.push(body);
    const turn: Message = {
      id: `88888888-8888-4888-8888-0000000001${String(sends.length).padStart(2, "0")}`,
      role: "user",
      created_at: 2,
      status: "pending",
      content: body.user_prompt,
      parent_message_id: body.parent_message_id,
      image_request: !!body.create_image,
    };
    chat.messages = [...chat.messages, turn];
    return route.fulfill({ json: turn });
  });
  const transport: { socket?: WebSocketRoute } = {};
  await page.routeWebSocket(`**/api/py/chat/stream/${CHAT}?**`, (socket) => {
    transport.socket = socket;
    socket.send(JSON.stringify({ type: "status", is_processing: false }));
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === "ping")
        socket.send(JSON.stringify({ type: "pong" }));
      else received.push(message);
    });
  });
  await page.goto("/e2e/chat-model-session");
  await expect(page.getByText("Hello! What shall we make?")).toBeVisible({
    timeout: 15_000,
  });
  await expect.poll(() => transport.socket).toBeDefined();
  const send = (packet: object) =>
    transport.socket!.send(JSON.stringify(packet));
  /** The fake provider finishes: the reply embeds the saved image. */
  const finish = () => {
    const request = chat.messages.at(-1)!;
    const reply: Message = {
      id: `${request.id.slice(0, -1)}9`,
      role: "assistant",
      created_at: 3,
      status: "completed",
      content: `![a-red-fox-42.png](asterism-file:${IMAGE})`,
      parent_message_id: request.id,
      inline_files: [
        {
          file_id: IMAGE,
          available: true,
          role: "produced",
          name: "a-red-fox-42.png",
          filename: "a-red-fox-42.png",
          mime_type: "image/png",
          kind: "image",
          size: PNG.length,
        },
      ],
    };
    chat.messages = [
      ...chat.messages.slice(0, -1),
      { ...request, status: "completed" },
      reply,
    ];
    send({ type: "complete", last_messages: chat.messages.slice(-2) });
    send({ type: "status", is_processing: false });
  };
  return { sends, received, send, finish };
}

const progress = (values: object) => ({
  type: "tool_progress",
  tool_call_id: "direct",
  name: "generate_image",
  ...values,
});

const chooseCreateImage = async (page: Page) => {
  await page.getByRole("button", { name: "More options" }).click();
  await page.getByRole("menuitem", { name: "Create image" }).click();
};

test("create an image, watch progress, open it and ask for more like it", async ({
  page,
}, info) => {
  const { sends, send, finish } = await openChat(page);

  await chooseCreateImage(page);
  const options = page.getByRole("group", { name: "Message options" });
  await expect(options.getByText("Image", { exact: true })).toBeVisible();
  const box = page.getByPlaceholder("Describe the image to create");
  await box.fill("A red fox in the snow");
  await box.press("Enter");
  await expect.poll(() => sends.length).toBe(1);
  expect(sends[0]).toMatchObject({
    user_prompt: "A red fox in the snow",
    create_image: true,
  });
  expect(sends[0]).not.toHaveProperty("compare");
  // One request only: the chip is gone for the next message.
  await expect(options.getByText("Image", { exact: true })).toHaveCount(0);

  send({ type: "status", is_processing: true });
  send(progress({ stage: "loading" }));
  const status = page.getByRole("status").filter({ hasText: "image" });
  await expect(status).toContainText("Loading the image model");
  send(progress({ stage: "running", step: 2, total: 4 }));
  await expect(status).toContainText("Creating the image: step 2 of 4");
  await expect(
    page.getByRole("progressbar", { name: "Image progress" }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("progress.png") });

  finish();
  const image = page.getByRole("button", {
    name: "Open image a-red-fox-42.png",
  });
  await expect(image).toBeVisible();
  await expect(
    page.getByRole("progressbar", { name: "Image progress" }),
  ).toHaveCount(0);

  await image.click();
  const viewer = page.getByRole("dialog");
  await expect(
    viewer.getByRole("img", { name: "a-red-fox-42.png" }),
  ).toBeVisible();
  await expect(viewer.getByText("Download")).toBeVisible();
  await expect(
    viewer.getByRole("link", { name: "Open in Files" }),
  ).toHaveAttribute("href", "/files/a-red-fox-42.png");
  await page.screenshot({ path: info.outputPath("viewer.png") });

  // The same description again; the generator picks a new seed.
  await viewer.getByRole("button", { name: "More like this" }).click();
  await expect(viewer).toHaveCount(0);
  await expect.poll(() => sends.length).toBe(2);
  expect(sends[1]).toMatchObject({
    user_prompt: "A red fox in the snow",
    create_image: true,
  });
});

test("an image request can be stopped", async ({ page }) => {
  const { sends, received, send } = await openChat(page);
  await chooseCreateImage(page);
  const box = page.getByPlaceholder("Describe the image to create");
  await box.fill("A heron at dawn");
  await box.press("Enter");
  await expect.poll(() => sends.length).toBe(1);
  send({ type: "status", is_processing: true });
  send(progress({ stage: "running", step: 1, total: 40 }));
  await expect(
    page.getByRole("progressbar", { name: "Image progress" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Stop generating", exact: true })
    .click();
  await expect
    .poll(() => received.some((message) => message.type === "cancel"))
    .toBe(true);
  send({ type: "status", is_processing: false });
  await expect(
    page.getByRole("progressbar", { name: "Image progress" }),
  ).toHaveCount(0);
});

test("Create image is not offered when image generation is unavailable", async ({
  page,
}) => {
  await openChat(page, false);
  await page.getByRole("button", { name: "More options" }).click();
  await expect(
    page.getByRole("menuitem", { name: "Compare models" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Create image" }),
  ).toHaveCount(0);
});
