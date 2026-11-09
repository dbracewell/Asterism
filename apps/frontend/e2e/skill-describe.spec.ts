import { expect, test, type Page, type WebSocketRoute } from "./support/test";

/**
 * US-71.2: describe a skill, watch the writer and its sub-agent through a
 * fake provider stream, ask for changes and save the reviewed draft.
 */
const CHAT = "c0000000-0000-4000-8000-000000000001";
const doc = (body: string) =>
  `---\nname: essay-feedback\ndescription: Gives feedback on student essays.\n---\n\n${body}\n`;
const FIRST = doc(
  "# Essay feedback\nComment on thesis, structure and evidence.",
);
const SECOND = doc("# Essay feedback\nGive three short comments.");

const assistant = (id: string, content: string) => ({
  id,
  role: "assistant",
  content,
  status: "completed",
  created_at: 1,
});

async function mockDrafting(page: Page) {
  const state = {
    turn: 0,
    started: [] as Record<string, unknown>[],
    sent: [] as Record<string, unknown>[],
    created: [] as string[],
    deleted: [] as string[],
    socket: null as WebSocketRoute | null,
  };
  await page.route("**/api/auth/token", (route) =>
    route.fulfill({ json: { token: "fixture-only" } }),
  );
  await page.route("**/api/py/chat/models", (route) =>
    route.fulfill({
      json: [
        {
          id: "m0000000-0000-4000-8000-000000000001",
          name: "Fake writer",
          provider_name: "Fake",
          provider_type: "openai",
          available: true,
          supports_tools: true,
        },
      ],
    }),
  );
  await page.route(
    (url) => url.pathname.startsWith("/api/py/skills"),
    async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      if (url.pathname.endsWith("/eligible"))
        return route.fulfill({
          json: {
            items: [],
            total: 0,
            page: 1,
            page_size: 1,
            policy_enabled: true,
            agent_revision: 1,
          },
        });
      if (url.pathname.endsWith("/drafts") && method === "POST") {
        state.started.push(route.request().postDataJSON());
        return route.fulfill({
          status: 201,
          json: {
            info: { id: CHAT, model_revision: 1, purpose: "skill_draft" },
            messages: [],
          },
        });
      }
      if (url.pathname.endsWith(`/drafts/${CHAT}`))
        return route.fulfill({
          json:
            state.turn === 0
              ? { chat_id: CHAT, status: "pending" }
              : {
                  chat_id: CHAT,
                  status: "ready",
                  message_id: `a${state.turn}`,
                  content: state.turn === 1 ? FIRST : SECOND,
                  name: "essay-feedback",
                  description: "Gives feedback on student essays.",
                },
        });
      if (method === "POST") {
        const content = route.request().postDataJSON().content as string;
        state.created.push(content);
        return route.fulfill({
          status: 201,
          json: {
            id: "s0000000-0000-4000-8000-000000000001",
            name: "essay-feedback",
            description: "Gives feedback on student essays.",
            content,
            revision: 1,
            created_at: 1,
            updated_at: 1,
          },
        });
      }
      const items = state.created.map((content) => ({
        id: "s0000000-0000-4000-8000-000000000001",
        name: "essay-feedback",
        description: "Gives feedback on student essays.",
        content,
        revision: 1,
        created_at: 1,
        updated_at: 1,
      }));
      return route.fulfill({
        json: { items, total: items.length, page: 1, page_size: 10 },
      });
    },
  );
  await page.route(`**/api/py/chat/${CHAT}/message`, (route) => {
    state.sent.push(route.request().postDataJSON());
    return route.fulfill({ json: { id: "u2", role: "user" } });
  });
  await page.route(`**/api/py/chat/${CHAT}`, (route) => {
    if (route.request().method() === "DELETE") state.deleted.push(CHAT);
    return route.fulfill({ status: 204 });
  });
  // The fake provider answers each resumed turn with one scripted run.
  await page.routeWebSocket(/\/api\/py\/chat\/stream\//, (socket) => {
    state.socket = socket;
    let answered = 0;
    socket.onMessage((message) => {
      const packet = JSON.parse(message.toString());
      if (packet.type !== "resume" || answered > state.turn) return;
      answered = state.turn + 1;
      const first = state.turn === 0;
      const reply = first ? FIRST : SECOND;
      const events: Record<string, unknown>[] = [
        { type: "status", is_processing: true },
        { type: "start" },
        {
          type: "delta",
          content: "Checking how teachers mark essays…",
          thinking: "",
        },
        ...(first
          ? [
              {
                type: "sub_agent",
                execution_id: "x1",
                sub_agent_id: "r1",
                sub_agent_name: "Researcher",
                depth: 1,
                event: { type: "start" },
              },
              {
                type: "sub_agent",
                execution_id: "x1",
                sub_agent_id: "r1",
                sub_agent_name: "Researcher",
                depth: 1,
                event: {
                  type: "complete",
                  content: "Rubrics weigh thesis and evidence.",
                  thinking: "",
                },
              },
            ]
          : []),
      ];
      events.forEach((event, index) =>
        setTimeout(() => socket.send(JSON.stringify(event)), index * 30),
      );
      setTimeout(
        () => {
          state.turn += 1;
          socket.send(
            JSON.stringify({
              type: "complete",
              last_messages: [
                assistant(`a${state.turn}`, `\`\`\`skill\n${reply}\`\`\``),
              ],
            }),
          );
          socket.send(JSON.stringify({ type: "status", is_processing: false }));
        },
        events.length * 30 + 400,
      );
    });
  });
  return state;
}

for (const width of [1280, 390]) {
  test(`describe a skill, review the draft, ask for changes and save at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 800 });
    const state = await mockDrafting(page);
    await page.goto("/e2e/skills?t=user&setting=skills");
    await page.getByRole("button", { name: "New skill" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("tab", { name: "Describe it" }).click();
    await dialog
      .getByRole("textbox", { name: "What should the skill do?" })
      .fill("Give feedback on student essays");
    await dialog.getByRole("button", { name: "Write draft" }).click();

    await expect(dialog.getByRole("status")).toHaveText(
      "Your agent is writing the draft…",
    );
    await expect(
      dialog.getByRole("region", { name: "Writer output" }),
    ).toContainText("Checking how teachers mark essays");
    await expect(dialog.getByTestId("sub-agent-x1")).toContainText(
      "Rubrics weigh thesis and evidence.",
    );
    await page.screenshot({
      path: info.outputPath(`describe-progress-${width}.png`),
    });

    // The finished draft opens in the editor with its preview.
    await expect(
      dialog.getByRole("heading", { name: "Essay feedback" }),
    ).toBeVisible();
    await expect(dialog.getByRole("tab", { name: "Write it" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(state.started).toEqual([
      expect.objectContaining({
        description: "Give feedback on student essays",
        model_id: "m0000000-0000-4000-8000-000000000001",
      }),
    ]);

    await dialog
      .getByRole("textbox", { name: "Ask for changes" })
      .fill("Shorter, please");
    await dialog.getByRole("button", { name: "Send changes" }).click();
    await expect
      .poll(() => state.sent)
      .toEqual([
        expect.objectContaining({
          user_prompt: "Shorter, please",
          parent_message_id: "a1",
        }),
      ]);
    // The revision replaces the draft and reopens its preview.
    await expect(dialog.getByText("Give three short comments.")).toBeVisible();
    await dialog.getByRole("tab", { name: "Source", exact: true }).click();
    await expect(
      dialog.getByRole("textbox", { name: "SKILL.md source" }),
    ).toHaveValue(SECOND);
    await page.screenshot({
      path: info.outputPath(`describe-review-${width}.png`),
    });

    await dialog.getByRole("button", { name: "Save skill" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "View or edit essay-feedback" }),
    ).toBeVisible();
    expect(state.created).toEqual([SECOND]);
    await expect.poll(() => state.deleted).toEqual([CHAT]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBeTruthy();
  });
}
