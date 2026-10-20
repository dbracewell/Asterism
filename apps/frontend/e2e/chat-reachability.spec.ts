import {
  expect,
  test,
  type Locator,
  type Page,
  type WebSocketRoute,
} from "@playwright/test";
import type { Chat, ChatFileScope, ChatModelChoice } from "../src/lib/client";

const C = "77777777-7777-4777-8777-777777777777";
const M = "11111111-1111-4111-8111-111111111111";
const F = "22222222-2222-4222-8222-222222222222";
const token = "unbrokentext".repeat(80);
const filename = `${"longfilename".repeat(35)}.txt`;
const rich = `# Rich response\n\n${token}\n\n\`${token}\`\n\n\`\`\`python\nprint("${token}")\n# final code line\n\`\`\`\n\n| ${Array.from({ length: 12 }, (_, i) => `Column ${i}`).join(" | ")} |\n| ${Array(12).fill("---").join(" | ")} |\n| ${Array(12).fill("wide table cell").join(" | ")} |\n\n$$\n${Array(24).fill("\\frac{a_i+b_i}{\\sqrt{x_i}}").join(" + ")}\n$$\n\n![${token}](https://untrusted.example/image.png)\n\nFinal response marker`;
const model: ChatModelChoice = {
  id: M,
  name: "Layout model",
  provider_id: M,
  provider_name: "Synthetic provider",
  available: true,
  context_window: 8192,
  supports_tools: true,
};
const scope: ChatFileScope = {
  chat_id: C,
  project_id: null,
  allowed_file_ids: [F],
  unavailable_file_ids: [],
  files: [{ file_id: F, sources: ["chat"], message_ids: [] }],
};
const chat: Chat = {
  info: {
    id: C,
    user_id: "test",
    title: "Synthetic layout",
    created_at: 0,
    updated_at: 0,
    selected_model_id: M,
    model_revision: 1,
    project_id: null,
  },
  messages: [
    ...Array.from({ length: 8 }, (_, i) => ({
      id: `earlier-${i}`,
      role: "assistant" as const,
      created_at: 0,
      content: `Earlier reply ${i}\n\n${"Conversation history. ".repeat(20)}`,
      status: "completed" as const,
    })),
    {
      id: "tool",
      role: "assistant",
      created_at: 0,
      content: "Tool details",
      status: "completed",
      thinking: token,
      tool_calls: [
        {
          id: "call",
          function: {
            name: "synthetic_tool",
            arguments: JSON.stringify({ input: token }),
          },
        },
      ],
    },
    {
      id: "user",
      role: "user",
      created_at: 0,
      content: token,
      status: "completed",
      files: [
        {
          file_id: F,
          filename: "source.txt",
          name: filename,
          size: 1234,
          mime_type: "text/plain",
          kind: "text",
          status: "ready",
        },
      ],
    },
    {
      id: "last",
      role: "assistant",
      parent_message_id: "user",
      created_at: 0,
      content: rich,
      status: "completed",
      tool_call_results: [
        {
          content: "",
          is_empty: false,
          tool_call: {
            id: "retrieval",
            function: { name: "search_knowledge", arguments: "{}" },
          },
          raw_result: {
            results: [
              {
                file_id: F,
                sources: ["chat"],
                artifact_generation: 1,
                chunk_id: "chunk",
                score: 1,
                match_kind: "text",
              },
            ],
          },
        },
      ],
    },
  ],
};

async function fixtures(page: Page) {
  const transport: { socket?: WebSocketRoute } = {};
  await page.route("**/api/py/chat/models", (route) =>
    route.fulfill({ json: [model] }),
  );
  await page.route(`**/api/py/chat/${C}`, (route) =>
    route.fulfill({ json: chat }),
  );
  await page.route(`**/api/py/chat/${C}/files/context`, (route) =>
    route.fulfill({ json: scope }),
  );
  await page.route(`**/api/py/chat/${C}/files/${F}/info`, (route) =>
    route.fulfill({
      json: {
        id: F,
        filename: "source.txt",
        original_name: filename,
        size: 1234,
        mime_type: "text/plain",
        kind: "text",
        content_status: "ready",
        projects: [],
      },
    }),
  );
  await page.route("**/api/py/files/source.txt/knowledge", (route) =>
    route.fulfill({ json: { status: "ready", caption: { status: "none" } } }),
  );
  await page.routeWebSocket(`**/api/py/chat/stream/${C}?**`, (socket) => {
    transport.socket = socket;
    socket.send(JSON.stringify({ type: "status", is_processing: false }));
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type === "ping")
        socket.send(JSON.stringify({ type: "pong" }));
    });
  });
  return transport;
}
async function reachable(control: Locator) {
  await expect(control).toBeEnabled();
  await control.scrollIntoViewIfNeeded();
  await control.focus();
  await expect(control).toBeFocused();
  await expect
    .poll(() =>
      control.evaluate((node) => {
        const r = node.getBoundingClientRect();
        const hit = document.elementFromPoint(
          r.x + r.width / 2,
          r.y + r.height / 2,
        );
        return (
          r.x >= 0 &&
          r.right <= innerWidth + 1 &&
          r.y >= 0 &&
          r.bottom <= innerHeight + 1 &&
          (hit === node || node.contains(hit))
        );
      }),
    )
    .toBe(true);
}

for (const { width, height, pane, enlarged } of [
  { width: 320, height: 300, pane: 320, enlarged: false },
  { width: 390, height: 800, pane: 390, enlarged: false },
  { width: 768, height: 300, pane: 768, enlarged: false },
  { width: 1440, height: 900, pane: 640, enlarged: false },
  { width: 1440, height: 400, pane: 320, enlarged: false },
  { width: 390, height: 600, pane: 390, enlarged: true },
]) {
  test(`rich content and a grown composer fit ${width}x${height} in ${pane}px${enlarged ? " at 200% text" : ""}`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await fixtures(page);
    await page.setViewportSize({ width, height });
    await page.goto(`/e2e/chat-reachability?pane=${pane}`);
    if (enlarged)
      await page.addStyleTag({
        content: "html { font-size: 200% !important; }",
      });
    if (width > 1000)
      await page.getByRole("button", { name: "Toggle test panels" }).click();
    const history = page.getByRole("region", { name: "Conversation history" });
    await expect(history).toBeVisible();
    for (const name of [
      "Scrollable code",
      "Scrollable table",
      "Scrollable math",
    ]) {
      const region = history.getByRole("region", { name, exact: true }).first();
      await reachable(region);
      expect(
        await region.evaluate(
          (node) => node.scrollWidth > node.clientWidth + 20,
        ),
      ).toBe(true);
      await page.keyboard.press("ArrowRight");
      await expect
        .poll(() => region.evaluate((node) => node.scrollLeft))
        .toBeGreaterThan(0);
    }
    const tool = history
      .locator("details")
      .filter({ hasText: "synthetic_tool" });
    await tool.locator("summary").click();
    await expect(tool).toContainText(token);
    const download = history.getByRole("link", { name: "Download source.txt" });
    await reachable(download);
    expect(
      await history.evaluate(
        (node) => node.scrollWidth <= node.clientWidth + 1,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Add attachments" }).click();
    await page.getByRole("menuitem", { name: "Files in context" }).click();
    const context = page.getByRole("dialog", { name: "Files in context" });
    await expect(
      context.getByRole("region", { name: "Chat attachments", exact: true }),
    ).toContainText(filename);
    await page.keyboard.press("Escape");
    await expect(context).toHaveCount(0);
    await page
      .getByLabel("Message", { exact: true })
      .fill(Array(8).fill("A multiline composer draft").join("\n"));
    await page.getByLabel("Choose attachments").setInputFiles(
      Array.from({ length: 6 }, (_, i) => ({
        name: `${i}-${filename}`,
        mimeType: "text/plain",
        buffer: Buffer.from("Synthetic attachment"),
      })),
    );
    const composer = page.locator('[data-slot="chat-composer"]');
    expect(
      await composer.evaluate((node) => node.getBoundingClientRect().top),
    ).toBeGreaterThanOrEqual(
      (await history.evaluate((node) => node.getBoundingClientRect().bottom)) -
        1,
    );
    await reachable(
      page.getByRole("button", { name: "Discard attachments", exact: true }),
    );
    await reachable(
      page.getByRole("button", { name: "Send message", exact: true }),
    );
    const regenerate = page
      .getByRole("button", { name: "Regenerate response", exact: true })
      .last();
    await reachable(regenerate);
    await page.keyboard.press("Tab");
    await expect(history.getByRole("button").last()).toBeFocused();
    const marker = history.getByText("Final response marker", { exact: true });
    await marker.scrollIntoViewIfNeeded();
    await expect(marker).toBeInViewport({ ratio: 1 });
    expect(
      await history.evaluate(
        (node) => node.scrollWidth <= node.clientWidth + 1,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath("rich-chat.png") });
    expect(errors).toEqual([]);
  });
}

test("conversation loading, failure, empty and cached-refresh states keep retry and composer reachable", async ({
  page,
}) => {
  await fixtures(page);
  await page.setViewportSize({ width: 320, height: 300 });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let state: "pending" | "failed" | "empty" | "ready" = "pending";
  await page.route(`**/api/py/chat/${C}`, async (route) => {
    if (state === "pending") await gate;
    if (state === "failed")
      return route.fulfill({ status: 500, json: { detail: token } });
    return route.fulfill({
      json: state === "empty" ? { ...chat, messages: [] } : chat,
    });
  });
  await page.goto("/e2e/chat-reachability");
  await expect(
    page.getByRole("status", { name: "Loading conversation" }),
  ).toBeVisible();
  state = "failed";
  release();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Could not load conversation",
  );
  state = "empty";
  await reachable(page.getByRole("button", { name: "Retry", exact: true }));
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByText("No messages yet. Write a message to begin."),
  ).toBeAttached();
  await reachable(page.getByLabel("Message", { exact: true }));
  state = "ready";
  await page
    .getByRole("button", { name: "Refresh conversation", exact: true })
    .click();
  await expect(
    page.getByText("Final response marker", { exact: true }),
  ).toBeAttached();
  state = "failed";
  await page
    .getByRole("button", { name: "Refresh conversation", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Could not refresh conversation. Showing saved messages.",
  );
  await expect(
    page.getByText("Final response marker", { exact: true }),
  ).toBeAttached();
  await reachable(page.getByRole("button", { name: "Retry", exact: true }));
  state = "ready";
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByText("Could not refresh conversation. Showing saved messages."),
  ).toHaveCount(0);
});

test("streaming preserves manual history position and jump/stop stay reachable beside a multiline draft", async ({
  page,
}) => {
  const transport = await fixtures(page);
  await page.setViewportSize({ width: 390, height: 400 });
  await page.goto("/e2e/chat-reachability");
  await reachable(page.getByLabel("Message", { exact: true }));
  await page
    .getByLabel("Message", { exact: true })
    .fill(Array(8).fill("Draft retained during streaming").join("\n"));
  await expect.poll(() => !!transport.socket).toBe(true);
  const socket = transport.socket!;
  let cancelled = false;
  socket.onMessage((raw) => {
    const packet = JSON.parse(String(raw));
    if (packet.type === "cancel") {
      cancelled = true;
      socket.send(JSON.stringify({ type: "status", is_processing: false }));
    }
    if (packet.type === "ping") socket.send(JSON.stringify({ type: "pong" }));
  });
  socket.send(JSON.stringify({ type: "status", is_processing: true }));
  socket.send(JSON.stringify({ type: "start" }));
  socket.send(
    JSON.stringify({
      type: "delta",
      thinking: "",
      content: "Streaming first marker",
    }),
  );
  const history = page.getByRole("region", { name: "Conversation history" });
  await expect(
    history.getByText("Streaming first marker", { exact: true }),
  ).toBeInViewport();
  await history.hover({ position: { x: 16, y: 16 } });
  await page.mouse.wheel(0, -100000);
  await expect.poll(() => history.evaluate((node) => node.scrollTop)).toBe(0);
  await expect(
    page.getByRole("button", { name: "Jump to latest message" }),
  ).toBeVisible();
  socket.send(
    JSON.stringify({
      type: "sub_agent",
      execution_id: "layout-worker",
      sub_agent_id: "worker",
      sub_agent_name: token,
      depth: 1,
      event: {
        type: "tool_call",
        tool_calls: [
          {
            id: "tool",
            type: "function",
            function: { name: "synthetic_tool", arguments: token },
          },
        ],
      },
    }),
  );
  socket.send(
    JSON.stringify({
      type: "delta",
      thinking: token,
      content: "Streaming first marker\n\nStreaming tail marker",
    }),
  );
  await expect(
    history.getByText("Streaming tail marker", { exact: true }),
  ).toBeAttached();
  expect(await history.evaluate((node) => node.scrollTop)).toBeLessThan(10);
  await reachable(page.getByRole("button", { name: "Jump to latest message" }));
  await page.keyboard.press("Enter");
  await expect(
    history.getByText("Streaming tail marker", { exact: true }),
  ).toBeInViewport();
  expect(
    await history.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
  ).toBe(true);
  await reachable(
    page.getByRole("button", { name: "Stop generating", exact: true }),
  );
  await page.keyboard.press("Enter");
  await expect.poll(() => cancelled).toBe(true);
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
    Array(8).fill("Draft retained during streaming").join("\n"),
  );
});

test("file context loading, failure and cached-refresh failure keep scope links fail-closed and retry reachable", async ({
  page,
}) => {
  await fixtures(page);
  await page.setViewportSize({ width: 320, height: 300 });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let state: "pending" | "failed" | "ready" = "pending";
  await page.route(`**/api/py/chat/${C}/files/context`, async (route) => {
    if (state === "pending") await gate;
    return state === "failed"
      ? route.fulfill({ status: 500, json: { detail: token } })
      : route.fulfill({ json: scope });
  });
  await page.goto("/e2e/chat-reachability");
  const context = page.getByRole("dialog", { name: "Files in context" });
  const openContext = async () => {
    await page.getByRole("button", { name: "Add attachments" }).click();
    await page.getByRole("menuitem", { name: "Files in context" }).click();
  };
  await openContext();
  await expect(
    page.getByText("Updating file scope…", { exact: true }),
  ).toBeAttached();
  state = "failed";
  release();
  await expect(context.getByRole("alert")).toContainText(
    "Could not verify current file scope.",
  );
  state = "ready";
  await reachable(context.getByRole("button", { name: "Retry", exact: true }));
  await context.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    context.getByRole("link", { name: filename, exact: true }),
  ).toBeAttached();
  state = "failed";
  await page.keyboard.press("Escape");
  await expect(context).toHaveCount(0);
  await page
    .getByRole("button", { name: "Refresh file scope", exact: true })
    .click();
  await openContext();
  await expect(context.getByRole("alert")).toContainText(
    "Could not verify current file scope.",
  );
  await expect(
    context.getByRole("link", { name: filename, exact: true }),
  ).toHaveCount(0);
  await reachable(context.getByRole("button", { name: "Retry", exact: true }));
  expect(
    await context.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
  ).toBe(true);
});
