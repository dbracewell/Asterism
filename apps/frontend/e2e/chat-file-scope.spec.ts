import { knowledgeArtifact } from "./support/knowledge-artifact";
import { expect, test, type Locator } from "./support/test";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const P = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SHARED = "11111111-1111-4111-8111-111111111111";
const LIBRARY = "22222222-2222-4222-8222-222222222222";
const UPLOAD = "33333333-3333-4333-8333-333333333333";
const source = (id: string, name: string, shared = false) => ({
  id,
  filename: name,
  original_name: name,
  kind: "text",
  mime_type: "text/plain",
  size: 10,
  content_status: "ready",
  content_error: null,
  created_at: 1,
  updated_at: 1,
  thumbnail: null,
  projects: shared ? [{ id: P, name: "Research", context_revision: 3 }] : [],
});
const sources = [
  source(SHARED, "shared.txt", true),
  source(LIBRARY, "library.txt"),
  source(UPLOAD, "upload.txt"),
];

test("keeps General isolated and shows two project chats with different local attachments across reopen, model and branch changes", async ({
  page,
}) => {
  const local: Record<string, string[]> = { [A]: [], [B]: [UPLOAD] };
  let general = false;
  let alternate = false;
  const memberships = new Set([SHARED]);
  const drafts = new Map<string, string[]>();
  const sends: Array<{
    draft_id: string;
    files: string[];
    expected_model_revision: number;
  }> = [];
  const messages: Record<string, object[]> = { [A]: [], [B]: [] };
  let promoted = 0;
  let removed = 0;
  let regenerated = 0;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(/\/api\/py\/files\//, (route) => {
    if (route.request().url().includes("/knowledge")) {
      if (route.request().method() === "POST") regenerated++;
      return route.fulfill({
        json: knowledgeArtifact(
          sources.find(
            (file) =>
              new URL(route.request().url()).pathname ===
              `/api/py/files/${file.filename}/knowledge`,
          )!.id,
        ),
      });
    }
    return route.fulfill({
      json: {
        files: sources.map((file) => ({
          ...file,
          projects: memberships.has(file.id)
            ? [{ id: P, name: "Research", context_revision: 3 }]
            : [],
        })),
        total: 3,
      },
    });
  });
  await page.route(new RegExp(`/api/py/projects/${P}(?:/files)?$`), (route) => {
    if (route.request().method() === "POST") {
      promoted++;
      for (const id of route.request().postDataJSON().file_ids)
        memberships.add(id);
      return route.fulfill({
        json: {
          context_revision: 4,
          changed_file_ids: [...memberships],
          unchanged_file_ids: [],
        },
      });
    }
    return route.fulfill({
      json: { id: P, name: "Research", context_revision: 3 },
    });
  });
  await page.route(/\/api\/py\/chat\//, (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.split("/").filter(Boolean);
    const tail = path.slice(3); // after api/py/chat
    if (tail[0] === "drafts") {
      if (tail.length === 1) {
        const id = `draft-${drafts.size + 1}`;
        drafts.set(id, []);
        return route.fulfill({
          json: {
            id,
            chat_id: route.request().postDataJSON().chat_id,
            file_ids: [],
            unavailable_file_ids: [],
            expires_at: 9999999999,
          },
        });
      }
      const ids = drafts.get(tail[1]) ?? [];
      if (tail[2] === "uploads") {
        ids.push(UPLOAD);
        return route.fulfill({ json: { files: [sources[2]] } });
      }
      if (tail[2] === "files") {
        const selected = route.request().postDataJSON().file_ids;
        drafts.set(
          tail[1],
          route.request().method() === "DELETE"
            ? ids.filter((id) => !selected.includes(id))
            : [...new Set([...ids, ...selected])],
        );
      }
      return route.fulfill({
        json: {
          id: tail[1],
          file_ids: drafts.get(tail[1]),
          unavailable_file_ids: [],
        },
      });
    }
    const chat = tail[0];
    const allowed = () => [
      ...new Set([
        ...(general ? [] : [...memberships]),
        ...(alternate ? [] : local[chat]),
      ]),
    ];
    if (tail[1] === "files" && tail[2] === "context")
      return route.fulfill({
        json: {
          chat_id: chat,
          project_id: general ? null : P,
          allowed_file_ids: allowed(),
          files: allowed().map((file_id) => ({
            file_id,
            sources: [
              ...(!general && memberships.has(file_id) ? ["project"] : []),
              ...(!alternate && local[chat].includes(file_id) ? ["chat"] : []),
            ],
            message_ids: [],
          })),
          unavailable_file_ids: [],
        },
      });
    if (tail[1] === "files") {
      if (route.request().method() === "DELETE") {
        removed++;
        local[chat] = local[chat].filter((id) => id !== tail[2]);
        return route.fulfill({
          json: { chat_id: chat, files: [], allowed_file_ids: [] },
        });
      }
      return allowed().includes(tail[2])
        ? route.fulfill({ json: sources.find((file) => file.id === tail[2]) })
        : route.fulfill({
            status: 404,
            json: { detail: "Source not in active scope" },
          });
    }
    if (tail[1] === "message") {
      const body = route.request().postDataJSON();
      sends.push(body);
      local[chat] = [...new Set([...local[chat], ...body.files])];
      const message = {
        id: `message-${sends.length}`,
        role: "user",
        content: body.user_prompt,
        status: "completed",
        created_at: 1,
        files: body.files.map((id: string) => {
          const file = sources.find((item) => item.id === id)!;
          return {
            file_id: id,
            filename: file.filename,
            name: file.original_name,
            kind: "text",
            size: 10,
            status: "ready",
            available: true,
          };
        }),
      };
      messages[chat].push(message);
      return route.fulfill({ json: message });
    }
    return route.fulfill({
      json: { info: { id: chat }, messages: messages[chat] },
    });
  });
  const contextDialog = page.getByRole("dialog", { name: "Files in context" });
  // A cold route can render the menu before hydration attaches handlers.
  // Repeat only until the chosen item has opened its dialog.
  const chooseFromMenu = async (item: string, dialog: Locator) => {
    await expect(async () => {
      if (!(await dialog.isVisible())) {
        await page.getByRole("button", { name: "Add attachments" }).click();
        await page
          .getByRole("menuitem", { name: item })
          .click({ timeout: 2000 });
      }
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 10000 });
  };
  const openContext = () => chooseFromMenu("Files in context", contextDialog);
  const closeContext = async () => {
    await page.keyboard.press("Escape");
    await expect(contextDialog).toHaveCount(0);
  };
  general = true;
  await page.goto(`/e2e/files?scope=general&chat=${A}`);
  await openContext();
  await expect(
    page.getByRole("region", { name: "Project files" }),
  ).toContainText("General has no project files");
  await expect(
    page.getByRole("region", { name: "Chat attachments" }),
  ).toContainText("No saved attachments");
  await closeContext();
  general = false;
  await page.goto(`/e2e/files?scope=project&chat=${A}`);
  await openContext();
  await expect(
    page
      .getByRole("region", { name: "Project files" })
      .getByRole("link", { name: "shared.txt" }),
  ).toHaveAttribute("href", `/c/${A}/files/${SHARED}`);
  await closeContext();
  const picker = page.getByRole("dialog");
  await chooseFromMenu("From library", picker);
  await expect(picker.getByText(/Already attached or available/)).toBeVisible();
  await picker.getByRole("button", { name: /library.txt/ }).click();
  await picker.getByRole("button", { name: "Attach selected (1)" }).click();
  await expect(picker).toHaveCount(0);
  await expect(page.getByLabel("Remove library.txt")).toBeVisible();
  await page.getByRole("button", { name: "Switch test model" }).click();
  await page.getByLabel("Message", { exact: true }).fill("Use my local file");
  await page.getByLabel("Send message").click();
  await openContext();
  await expect(
    page
      .getByRole("region", { name: "Chat attachments" })
      .getByRole("link", { name: "library.txt" }),
  ).toBeVisible();
  await closeContext();
  expect(sends[0]).toMatchObject({
    draft_id: "draft-1",
    files: [LIBRARY],
    expected_model_revision: 2,
  });
  expect(promoted).toBe(0);
  expect(regenerated).toBe(0);
  await page.reload();
  await openContext();
  await expect(
    page.getByRole("region", { name: "Chat attachments" }),
  ).toContainText("library.txt");
  await closeContext();
  alternate = true;
  await page.getByRole("button", { name: "Switch test branch" }).click();
  await openContext();
  await expect(
    page.getByRole("region", { name: "Chat attachments" }),
  ).toContainText("No saved attachments");
  await closeContext();
  alternate = false;
  await page.goto(`/e2e/files?scope=project&chat=${B}`);
  await openContext();
  const locals = page.getByRole("region", { name: "Chat attachments" });
  await expect(locals).toContainText("upload.txt");
  await expect(locals).not.toContainText("library.txt");
  await locals.getByRole("button", { name: "Add to project" }).click();
  await expect.poll(() => promoted).toBe(1);
  await locals.getByRole("button", { name: "Remove chat attachment" }).click();
  await expect(page.getByRole("alertdialog")).toContainText(
    "project memberships remain",
  );
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect.poll(() => removed).toBe(1);
  await expect(locals).not.toContainText("upload.txt");
  await expect(
    page.getByRole("region", { name: "Project files" }),
  ).toContainText("upload.txt");
  await page.screenshot({
    path: "test-results/chat-files-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/chat-files-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("preserves retrieval provenance while revoked citations and source views fail closed", async ({
  page,
}) => {
  let authorized = true;
  await page.route(new RegExp(`/api/py/chat/${A}$`), (route) =>
    route.fulfill({
      json: {
        info: { id: A },
        messages: [
          {
            id: "result",
            role: "assistant",
            content: "An answer based on a chat attachment",
            files: [],
            tool_call_results: [
              {
                content: "",
                is_empty: false,
                tool_call: {
                  id: "tool",
                  function: { name: "search_knowledge", arguments: "{}" },
                },
                raw_result: {
                  results: [
                    {
                      file_id: LIBRARY,
                      sources: ["chat"],
                      artifact_generation: 2,
                      chunk_id: "chunk",
                      score: 0.8,
                      match_kind: "text",
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    }),
  );
  await page.route(
    new RegExp(`/api/py/chat/${A}/files/${LIBRARY}/info$`),
    (route) =>
      authorized
        ? route.fulfill({ json: sources[1] })
        : route.fulfill({ status: 404, json: { detail: "Revoked source" } }),
  );
  await page.goto(`/e2e/files?scope=project&chat=${A}`);
  const citations = page.getByRole("region", { name: "Retrieved sources" });
  const chip = citations.getByRole("link", { name: "Source 1: library.txt" });
  await expect(chip).toHaveAttribute("href", `/c/${A}/files/${LIBRARY}`);
  await chip.focus();
  await expect(page.getByRole("tooltip")).toContainText(
    "This chat · generation 2 · text",
  );
  authorized = false;
  await page.reload();
  await expect(citations).toContainText("Source unavailable in this chat");
  await expect(citations.getByRole("link")).toHaveCount(0);
  await page.goto(`/e2e/files?scope=project&chat=${A}&file=${LIBRARY}`);
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "no longer available in the active chat context",
  );
  await expect(page.getByText("Download source")).toHaveCount(0);
});
