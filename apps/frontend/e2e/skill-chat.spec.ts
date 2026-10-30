import { expect, test, type Page } from "./support/test";
test.use({ hasTouch: true });
const skills = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    name: "review",
    description: "Review carefully",
    revision: 1,
    created_at: 1,
    updated_at: 1,
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    name: "write",
    description: "Write clearly",
    revision: 1,
    created_at: 1,
    updated_at: 1,
  },
];
async function mock(page: Page) {
  const state = {
    fail: false,
    policy: true,
    lookupFail: false,
    requests: [] as Record<string, unknown>[],
  };
  await page.route("**/api/py/skills/eligible*", async (route) => {
    if (state.lookupFail)
      return route.fulfill({ status: 503, json: { detail: "Unavailable" } });
    const query =
      new URL(route.request().url()).searchParams.get("query") ?? "";
    return route.fulfill({
      json: {
        items: state.policy ? skills.filter((s) => s.name.includes(query)) : [],
        total: 2,
        page: 1,
        page_size: 100,
        policy_enabled: state.policy,
        agent_revision: 1,
      },
    });
  });
  await page.route("**/api/py/test-skill-send", async (route) => {
    state.requests.push(route.request().postDataJSON());
    return route.fulfill({
      status: state.fail ? 409 : 200,
      json: { ok: !state.fail },
    });
  });
  return state;
}
for (const [width, height] of [
  [1280, 800],
  [390, 600],
  [320, 360],
]) {
  test(`slash selection, rejected draft, literal recovery and branch isolation at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height });
    const state = await mock(page);
    await page.goto("/e2e/skill-chat");
    const input = page.getByLabel("Message", { exact: true });
    await input.fill("/");
    await expect(page.getByRole("option", { name: /review/ })).toBeVisible();
    await input.press("ArrowDown");
    await input.press("Enter");
    await expect(page.getByLabel("Remove write")).toBeVisible();
    await expect(input).toBeFocused();
    await input.fill("Keep this draft");
    state.fail = true;
    await page.getByLabel("Send message").click();
    await expect(
      page.getByText("Selection rejected; remove or retry."),
    ).toBeVisible();
    await expect(input).toHaveValue("Keep this draft");
    await page.reload();
    await expect(input).toHaveValue("Keep this draft");
    await expect(page.getByLabel("Remove write")).toBeVisible();
    await page.getByRole("button", { name: "Project", exact: true }).click();
    await expect(page.getByLabel("Remove write")).toHaveCount(0);
    await expect(input).toHaveValue("");
    await page.getByRole("button", { name: "General", exact: true }).click();
    await expect(input).toHaveValue("Keep this draft");
    await page
      .getByRole("button", { name: "Switch owner", exact: true })
      .click();
    await expect(input).toHaveValue("");
    await expect(page.getByLabel("Remove write")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Switch owner", exact: true })
      .click();
    await expect(input).toHaveValue("Keep this draft");
    await input.fill("/unknown Keep this");
    await page.getByLabel("Send message").click();
    await page.getByRole("button", { name: "Send as literal text" }).click();
    state.fail = false;
    await page.getByLabel("Send message").click();
    await expect(page.getByLabel("Last accepted payload")).toContainText(
      "/unknown Keep this",
    );
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`skill-chat-${width}.png`),
      fullPage: true,
    });
  });
}
test("typed commands preserve order and support empty-body sends, lookup retry and disabled policy", async ({
  page,
}) => {
  const state = await mock(page);
  await page.goto("/e2e/skill-chat");
  const input = page.getByLabel("Message", { exact: true });
  await input.fill("/review /write /review");
  await page.getByLabel("Send message").click();
  await expect.poll(() => state.requests.length).toBe(1);
  expect(state.requests[0]).toMatchObject({
    prompt: "",
    skills: {
      expected_revision: 0,
      skill_ids: skills.map((s) => s.id),
      refresh_ids: [],
    },
  });
  await page.getByRole("button", { name: "Project", exact: true }).click();
  state.lookupFail = true;
  await input.fill("/");
  await expect(
    page.getByRole("button", { name: "Retry skills" }),
  ).toBeVisible();
  state.lookupFail = false;
  await page.getByRole("button", { name: "Retry skills" }).click();
  await expect(page.getByRole("option", { name: /review/ })).toBeVisible();
  await input.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  state.policy = false;
  await input.fill("/write");
  await expect(
    page.getByText("Skill activation is disabled by an administrator."),
  ).toBeVisible();
});

for (const project of [null, "00000000-0000-4000-8000-000000000099"]) {
  test(`real chat component keeps accepted skills across followups and removes them in ${project ? "project" : "General"}`, async ({
    page,
  }) => {
    const { mockDefaultPersonas } = await import("./support/personas");
    await mockDefaultPersonas(page);
    await mock(page);
    const C = "77777777-7777-4777-8777-777777777777";
    const M = "11111111-1111-4111-8111-111111111111";
    const model = {
      id: M,
      name: "Alpha",
      provider_id: "33333333-3333-4333-8333-333333333333",
      provider_name: "Provider",
      provider_type: "generic_openai" as const,
      available: true,
      supports_tools: false,
    };
    const chat: import("../src/lib/client").Chat = {
      info: {
        id: C,
        user_id: "test",
        created_at: 0,
        updated_at: 0,
        title: "Skill workflow",
        selected_model_id: M,
        selected_model: model,
        model_revision: 1,
        project_id: project,
        active_skills: {
          revision: 1,
          skills: [
            {
              ...skills[0],
              digest: "pinned",
              available: true,
              update_available: true,
            },
          ],
        },
      },
      messages: [
        {
          id: "88888888-8888-4888-8888-888888888888",
          role: "user",
          status: "completed",
          content: "Initial",
          created_at: 0,
          skills: [{ ...skills[0], digest: "pinned" }],
        },
        {
          id: "99999999-9999-4999-8999-999999999999",
          role: "assistant",
          status: "completed",
          content: "Answer",
          created_at: 0,
        },
      ],
    };
    const sends: Record<string, unknown>[] = [];
    await page.route("**/api/py/chat/models", (route) =>
      route.fulfill({ json: [model] }),
    );
    await page.route(`**/api/py/chat/${C}/files/context`, (route) =>
      route.fulfill({
        json: {
          chat_id: C,
          project_id: project,
          allowed_file_ids: [],
          unavailable_file_ids: [],
          files: [],
        },
      }),
    );
    await page.route(`**/api/py/chat/${C}`, (route) =>
      route.fulfill({ json: chat }),
    );
    await page.route(`**/api/py/chat/${C}/message`, async (route) => {
      const body = route.request().postDataJSON();
      sends.push(body);
      if (body.skills)
        chat.info.active_skills = {
          revision: (chat.info.active_skills?.revision ?? 0) + 1,
          skills: body.skills.skill_ids.map((id: string) => ({
            ...skills.find((s) => s.id === id)!,
            digest: "pinned",
            available: true,
          })),
        };
      const message: import("../src/lib/client").Message = {
        id: crypto.randomUUID(),
        role: "user",
        status: "completed",
        created_at: 1,
        content: body.user_prompt,
        parent_message_id: body.parent_message_id,
        skills: chat.info.active_skills?.skills,
      };
      chat.messages.push(message);
      return route.fulfill({ json: message });
    });
    await page.routeWebSocket(`**/api/py/chat/stream/${C}?**`, (socket) => {
      socket.send(JSON.stringify({ type: "status", is_processing: false }));
      socket.onMessage((raw) => {
        const packet = JSON.parse(String(raw));
        if (packet.type === "ping")
          socket.send(JSON.stringify({ type: "pong" }));
        if (packet.type === "resume") {
          socket.send(
            JSON.stringify({ type: "complete", last_messages: chat.messages }),
          );
          socket.send(JSON.stringify({ type: "status", is_processing: false }));
        }
      });
    });
    await page.goto("/e2e/chat-model-session");
    const input = page.getByLabel("Message", { exact: true });
    await expect(page.getByLabel("Remove review")).toBeVisible();
    await expect(page.getByLabel("Message skills")).toContainText(
      "/review · r1",
    );
    await input.fill("Follow up");
    await page.getByLabel("Send message").click();
    await expect.poll(() => sends.length).toBe(1);
    expect(sends[0]).not.toHaveProperty("skills");
    await expect(input).toBeEnabled();
    await expect(page.getByLabel("Remove review")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Remove review")).toBeVisible();
    await page.getByLabel("Refresh review").click();
    await input.fill("Refresh explicitly");
    await page.getByLabel("Send message").click();
    await expect.poll(() => sends.length).toBe(2);
    expect(sends[1]).toMatchObject({
      skills: {
        expected_revision: 1,
        skill_ids: [skills[0].id],
        refresh_ids: [skills[0].id],
      },
    });
    await expect(input).toBeEnabled();
    await page.getByLabel("Remove review").click();
    await input.fill("No workflow now");
    await page.getByLabel("Send message").click();
    await expect.poll(() => sends.length).toBe(3);
    expect(sends[2]).toMatchObject({
      skills: { expected_revision: 2, skill_ids: [], refresh_ids: [] },
    });
    await page.reload();
    await expect(page.getByLabel("Remove review")).toHaveCount(0);
  });
}

test("new project chat forwards ordered skill IDs and stripped prompt through the generated API", async ({
  page,
}) => {
  const { mockDefaultPersonas } = await import("./support/personas");
  await mockDefaultPersonas(page);
  await mock(page);
  const project = "00000000-0000-4000-8000-000000000099";
  await page.route("**/api/py/chat/models", (route) =>
    route.fulfill({
      json: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "Alpha",
          provider_id: "33333333-3333-4333-8333-333333333333",
          provider_name: "Provider",
          provider_type: "generic_openai",
          available: true,
        },
      ],
    }),
  );
  await page.route(`**/api/py/projects/${project}`, (route) =>
    route.fulfill({
      json: {
        id: project,
        name: "Project",
        description: "",
        system_prompt: "",
        context_revision: 1,
      },
    }),
  );
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/py/chat/", (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        info: { id: "77777777-7777-4777-8777-777777777777" },
        messages: [],
      },
    });
  });
  await page.goto(`/e2e/chat-model-session?draft=true&project_id=${project}`);
  await page
    .getByLabel("Message", { exact: true })
    .fill("/review /write Explain this");
  await page.getByLabel("Send message").click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({
    project_id: project,
    user_prompt: "Explain this",
    skills: {
      expected_revision: 0,
      skill_ids: skills.map((s) => s.id),
      refresh_ids: [],
    },
  });
});
