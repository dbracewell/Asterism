import { mockDefaultPersonas } from "./support/personas";
import { expect, test, type Page, type WebSocketRoute } from "./support/test";
import type {
  Chat,
  ChatModelChoice,
  DelegationRecord,
  Message,
  SubAgentDefinition,
} from "../src/lib/client";

/**
 * US-75.4: give a sub-agent a skill in its editor, then see it load the skill
 * in a delegated run, live and in history.
 */
const MODEL = "11111111-1111-4111-8111-111111111111";
const WORKER = "22222222-2222-4222-8222-222222222222";
const CHAT = "77777777-7777-4777-8777-777777777777";
const RUN = "99999999-9999-4999-8999-000000000001";
const skillId = (n: number) =>
  `55555555-5555-4555-8555-${String(n).padStart(12, "0")}`;
const skills = Array.from({ length: 12 }, (_, i) => ({
  id: skillId(i + 1),
  name: i === 0 ? "review-code" : `skill-${String(i + 1).padStart(2, "0")}`,
  description:
    i === 0 ? "Review a diff for edge cases." : "Another reusable skill.",
  revision: 1,
  created_at: i,
  updated_at: i,
}));

async function mockAgentSettings(page: Page) {
  const state = {
    worker: {
      id: WORKER,
      name: "Reviewer",
      description: "Reviews code.",
      model_id: MODEL,
      model_available: true,
      system_prompt: "Review carefully.",
      tools: [],
      max_steps: 5,
      config_revision: 3,
    } as SubAgentDefinition,
    assigned: [] as string[],
    revision: 3,
    calls: [] as string[],
    skillBodies: [] as unknown[],
  };
  await page.route("**/api/py/settings/user/main-agent", (route) =>
    route.fulfill({
      json: {
        id: "44444444-4444-4444-8444-444444444444",
        name: "Main",
        description: "",
        system_prompt: "",
        tools: [],
        max_steps: 5,
      },
    }),
  );
  await page.route("**/api/py/chat/models", (route) =>
    route.fulfill({
      json: [
        {
          id: MODEL,
          name: "Worker model",
          provider_id: MODEL,
          provider_name: "Test provider",
          provider_type: "generic_openai",
          available: true,
          supports_tools: true,
        },
      ],
    }),
  );
  await page.route("**/api/py/tools/active", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route(
    (url) => url.pathname.startsWith("/api/py/skills"),
    (route) => {
      const url = new URL(route.request().url());
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
      const page = Number(url.searchParams.get("page") ?? 1);
      const size = Number(url.searchParams.get("page_size") ?? 10);
      const query = url.searchParams.get("query") ?? "";
      const found = skills.filter((skill) => skill.name.includes(query));
      return route.fulfill({
        json: {
          items: found.slice((page - 1) * size, page * size),
          total: found.length,
          page,
          page_size: size,
        },
      });
    },
  );
  await page.route(
    (url) => url.pathname.startsWith("/api/py/agents/sub-agents"),
    (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      if (url.pathname.endsWith("/skills")) {
        if (method === "PUT") {
          const body = route.request().postDataJSON();
          state.calls.push("skills");
          state.skillBodies.push(body);
          if (body.expected_revision !== state.revision)
            return route.fulfill({
              status: 409,
              json: { detail: "Sub-agent changed" },
            });
          state.assigned = body.skill_ids;
          state.revision += 1;
        }
        return route.fulfill({
          json: { skill_ids: state.assigned, revision: state.revision },
        });
      }
      if (method === "PUT") {
        state.calls.push("definition");
        state.revision += 1;
        state.worker = {
          ...state.worker,
          ...route.request().postDataJSON(),
          config_revision: state.revision,
        };
        return route.fulfill({ json: state.worker });
      }
      return route.fulfill({
        json: { items: [state.worker], total: 1, page: 1, page_size: 10 },
      });
    },
  );
  return state;
}

for (const width of [1280, 390]) {
  test(`choose a sub-agent's skills in its editor at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await mockAgentSettings(page);
    await page.goto("/e2e/agent-settings");
    await page.getByRole("button", { name: "Edit Reviewer" }).click();
    const dialog = page.getByRole("dialog");
    const skillsGroup = dialog.getByRole("group", { name: /^Skills/ });
    await expect(skillsGroup.getByText("0 selected")).toBeVisible();

    // The picker pages and searches; choices on other pages are kept.
    await skillsGroup.getByRole("checkbox", { name: /review-code/ }).check();
    await skillsGroup.getByRole("button", { name: "Next skills" }).click();
    await skillsGroup.getByRole("checkbox", { name: /skill-12/ }).check();
    await skillsGroup
      .getByRole("textbox", { name: "Find skills" })
      .fill("review");
    await expect(
      skillsGroup.getByRole("checkbox", { name: /review-code/ }),
    ).toBeChecked();
    await expect(skillsGroup.getByText(/2 selected/)).toBeVisible();
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`sub-agent-skills-${width}.png`),
      fullPage: true,
    });

    await dialog.getByRole("button", { name: "Save configuration" }).click();
    await expect(dialog).toHaveCount(0);
    // The definition saves first; the skills follow its new revision.
    expect(state.calls).toEqual(["definition", "skills"]);
    expect(state.skillBodies).toEqual([
      { skill_ids: [skillId(1), skillId(12)], expected_revision: 4 },
    ]);

    await page.getByRole("button", { name: "Edit Reviewer" }).click();
    await expect(skillsGroup.getByText(/2 selected/)).toBeVisible();
    await expect(
      skillsGroup.getByRole("checkbox", { name: /review-code/ }),
    ).toBeChecked();
  });
}

const model: ChatModelChoice = {
  id: MODEL,
  name: "Alpha",
  provider_id: "33333333-3333-4333-8333-333333333333",
  provider_name: "Provider",
  provider_type: "generic_openai",
  available: true,
  supports_tools: true,
  context_window: 4096,
};
const load = {
  id: "load",
  type: "function" as const,
  function: { name: "load_skill", arguments: '{"name":"review-code"}' },
};
const loaded = {
  tool_call: load,
  content: JSON.stringify({
    skill_id: skillId(1),
    name: "review-code",
    revision: 2,
    instructions: "# Review\nCheck edge cases.",
  }),
  raw_result: null,
  is_empty: false,
};
const delegate = {
  id: "delegate",
  type: "function" as const,
  function: {
    name: "sub_agent",
    arguments: JSON.stringify({ agent_id: WORKER, prompt: "Review it" }),
  },
};
const record: DelegationRecord = {
  execution_id: RUN,
  parent_execution_id: null,
  sub_agent_id: WORKER,
  name: "Reviewer",
  model_name: "Worker model",
  depth: 1,
  status: "completed",
  started_at_ms: 1_000,
  ended_at_ms: 4_000,
  tool_calls: [load],
  tool_results: [loaded],
  skill_loads: [{ skill_id: skillId(1), name: "review-code", revision: 2 }],
  output: "No edge cases are missing.",
  error: null,
};
const userMessage: Message = {
  id: "88888888-8888-4888-8888-000000000001",
  role: "user",
  created_at: 0,
  status: "completed",
  content: "Review my diff.",
};
const step: Message = {
  id: "88888888-8888-4888-8888-000000000002",
  role: "assistant",
  created_at: 0,
  status: "completed",
  content: "",
  parent_message_id: userMessage.id,
  tool_calls: [delegate],
  tool_call_results: [
    {
      tool_call: delegate,
      content: "No edge cases are missing.",
      raw_result: "No edge cases are missing.",
      is_empty: false,
    },
  ],
  delegations: [record],
};

async function openChat(page: Page) {
  await mockDefaultPersonas(page);
  const chat: Chat = {
    info: {
      id: CHAT,
      user_id: "test",
      title: "Review",
      created_at: 0,
      updated_at: 0,
      selected_model_id: MODEL,
      selected_model: model,
      model_revision: 1,
      project_id: null,
    },
    messages: [userMessage],
  };
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
  await expect(page.getByText("Review my diff.")).toBeVisible({
    timeout: 15_000,
  });
  await expect.poll(() => transport.socket).toBeDefined();
  return { socket: transport.socket!, chat };
}

test("a delegated run shows the sub-agent loading its skill, live and in history", async ({
  page,
}, info) => {
  const { socket, chat } = await openChat(page);
  const envelope = (event: object) =>
    JSON.stringify({
      type: "sub_agent",
      execution_id: RUN,
      parent_execution_id: null,
      sub_agent_id: WORKER,
      sub_agent_name: "Reviewer",
      model_id: MODEL,
      model_name: "Worker model",
      depth: 1,
      event,
    });
  socket.send(JSON.stringify({ type: "status", is_processing: true }));
  socket.send(JSON.stringify({ type: "start" }));
  socket.send(envelope({ type: "start" }));
  socket.send(envelope({ type: "tool_call", tool_calls: [load] }));
  const live = page.getByRole("region", { name: "Sub-agent activity" });
  await expect(live.getByText("Loading skill review-code")).toBeVisible();
  socket.send(
    envelope({
      type: "complete",
      content: "",
      tool_calls: [load],
      tool_results: [loaded],
    }),
  );
  await expect(live.getByText("Loaded skill review-code")).toBeVisible();

  chat.messages = [userMessage, step];
  socket.send(
    JSON.stringify({ type: "complete", last_messages: [userMessage, step] }),
  );
  const history = page.getByRole("region", { name: "Conversation history" });
  await history
    .getByRole("button", { name: /^1 agent · 3\.0 s · 1 tool/ })
    .click();
  const run = history.getByTestId(`delegation-${RUN}`);
  await run.getByRole("button", { name: "1 tool call", exact: true }).click();
  await expect(
    run.getByRole("button", { name: /^Loaded skill review-code/ }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("sub-agent-skill-load.png"),
    fullPage: true,
  });
});
