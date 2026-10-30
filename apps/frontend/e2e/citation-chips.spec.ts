import { mockDefaultPersonas } from "./support/personas";
import { expect, test, type Page, type WebSocketRoute } from "./support/test";
import type { Chat, ChatModelChoice, Message } from "../src/lib/client";

const M = "11111111-1111-4111-8111-111111111111";
const C = "77777777-7777-4777-8777-777777777777";

const model: ChatModelChoice = {
  id: M,
  name: "Alpha",
  provider_id: "33333333-3333-4333-8333-333333333333",
  provider_name: "Provider",
  provider_type: "generic_openai",
  available: true,
  supports_tools: true,
  context_window: 4096,
};

const F1 = "99999999-9999-4999-8999-000000000001";
const F2 = "99999999-9999-4999-8999-000000000002";
const F3 = "99999999-9999-4999-8999-000000000003";
const longName = `${"constellation-survey-".repeat(8)}catalogue.pdf`;
const names: Record<string, string> = {
  [F1]: "gaia-dr3.md",
  [F2]: longName,
  [F3]: "revoked.txt",
};

const searchCall = {
  id: "search",
  type: "function" as const,
  function: { name: "search_knowledge", arguments: '{"query":"bright stars"}' },
};
const hit = (file_id: string, excerpt: string) => ({
  file_id,
  sources: ["chat"],
  message_ids: [],
  artifact_generation: 1,
  chunk_id: `${file_id}:0`,
  score: 0.7,
  match_kind: "text",
  excerpt,
});

const messages: Message[] = [
  {
    id: "88888888-8888-4888-8888-000000000001",
    role: "user",
    created_at: 0,
    status: "completed",
    content: "Which catalogues list bright stars?",
  },
  {
    id: "88888888-8888-4888-8888-000000000002",
    role: "assistant",
    created_at: 0,
    status: "completed",
    content: "",
    parent_message_id: "88888888-8888-4888-8888-000000000001",
    tool_calls: [searchCall],
    tool_call_results: [
      {
        content: "3 results",
        raw_result: {
          results: [
            hit(F1, "Gaia DR3 lists 1.8 billion sources <script>x</script>"),
            hit(F2, "The survey covers stars brighter than magnitude 6."),
            hit(F1, "A second Gaia passage."),
            hit(F3, "Revoked text"),
          ],
        },
        is_empty: false,
        tool_call: searchCall,
      },
    ],
  },
  {
    id: "88888888-8888-4888-8888-000000000003",
    role: "assistant",
    created_at: 0,
    status: "completed",
    content: "Gaia and the survey catalogue are the main catalogues.",
    parent_message_id: "88888888-8888-4888-8888-000000000002",
  },
];
async function openChat(page: Page, thinking: boolean) {
  await mockDefaultPersonas(page);
  const chat: Chat = {
    info: {
      id: C,
      user_id: "test",
      title: "Sources",
      created_at: 0,
      updated_at: 0,
      selected_model_id: M,
      selected_model: model,
      model_revision: 1,
      project_id: null,
    },
    messages: [...messages],
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
        unavailable_file_ids: [],
        files: [],
      },
    }),
  );
  await page.route(`**/api/py/chat/${C}`, (route) =>
    route.fulfill({ json: chat }),
  );
  await page.route(/\/api\/py\/chat\/[^/]+\/files\/[^/]+\/info$/, (route) => {
    const fileId = new URL(route.request().url()).pathname.split("/").at(-2)!;
    if (fileId === F3)
      return route.fulfill({ status: 404, json: { detail: "Revoked" } });
    return route.fulfill({
      json: {
        id: fileId,
        filename: names[fileId],
        original_name: names[fileId],
        size: 10,
        kind: "text",
        projects: [],
        created_at: 0,
        updated_at: 0,
      },
    });
  });
  const transport: { socket?: WebSocketRoute } = {};
  await page.routeWebSocket(`**/api/py/chat/stream/${C}?**`, (socket) => {
    transport.socket = socket;
    socket.send(JSON.stringify({ type: "status", is_processing: false }));
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type === "ping") {
        socket.send(JSON.stringify({ type: "pong" }));
      }
    });
  });
  await page.goto(`/e2e/chat-model-session?thinking=${thinking}`);
  await expect(page.getByText("main catalogues")).toBeVisible({
    timeout: 15_000,
  });
  await expect.poll(() => transport.socket).toBeDefined();
  return { socket: transport.socket!, chat };
}

const history = (page: Page) =>
  page.getByRole("region", { name: "Conversation history" });

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1280, height: 900 },
]) {
  test(`numbered source chips at ${viewport.width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    await openChat(page, false);
    const sources = history(page).getByRole("region", {
      name: "Retrieved sources",
    });
    const gaia = sources.getByRole("link", { name: "Source 1: gaia-dr3.md" });
    const survey = sources.getByRole("link", {
      name: `Source 2: ${longName}`,
    });
    await expect(gaia).toHaveAttribute("href", `/c/${C}/files/${F1}`);
    await expect(survey).toHaveAttribute("href", `/c/${C}/files/${F2}`);
    await expect(sources.getByRole("alert")).toHaveText(
      "Source unavailable in this chat",
    );
    await expect(sources.getByRole("link")).toHaveCount(2);

    // Long names truncate inside the chip and never widen the transcript.
    const box = await survey.boundingBox();
    expect(box!.height).toBeLessThan(32);
    expect(
      await history(page).evaluate(
        (node) => node.scrollWidth <= node.clientWidth + 1,
      ),
    ).toBe(true);

    await gaia.focus();
    const preview = page.getByRole("tooltip");
    await expect(preview).toContainText(
      "Gaia DR3 lists 1.8 billion sources <script>x</script>",
    );
    await expect(preview).toContainText(
      "This chat · generation 1 · text · 2 passages",
    );
    await expect(gaia).toHaveAccessibleDescription(/Gaia DR3/);
    await page.screenshot({ path: info.outputPath("sources-focus.png") });

    await page.keyboard.press("Tab");
    await expect(survey).toBeFocused();
    // The previous preview may still be animating out.
    await expect(
      page.getByRole("tooltip").filter({ hasText: "magnitude 6" }),
    ).toContainText(longName);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await gaia.hover();
    await expect(
      page.getByRole("tooltip").filter({ hasText: "Gaia DR3" }),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath("sources-hover.png") });
  });
}
