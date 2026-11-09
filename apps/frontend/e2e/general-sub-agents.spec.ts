import { mockDefaultPersonas } from "./support/personas";
import { expect, test, type Page, type WebSocketRoute } from "./support/test";
import type {
  Chat,
  ChatModelChoice,
  GeneralSubAgents,
  Message,
  SubAgentDefinition,
} from "../src/lib/client";

// US-68.2: choose General chat sub-agents, then delegate from a General chat.
const M = "11111111-1111-4111-8111-111111111111";
const C = "77777777-7777-4777-8777-777777777777";
const RESEARCH = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const OFFLINE = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002";
const GENERAL = "**/api/py/settings/user/main-agent/general-sub-agents";

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
const research: SubAgentDefinition = {
  id: RESEARCH,
  name: "Researcher",
  description: "Finds sources",
  model_id: M,
  model_available: true,
};
const offline: SubAgentDefinition = {
  id: OFFLINE,
  name: "Offline helper",
  model_id: "44444444-4444-4444-8444-444444444444",
  model_available: false,
  model_unavailable_reason: "Its provider is disabled.",
};

async function mockSettings(page: Page) {
  await page.route("**/api/py/settings/user/main-agent", (route) =>
    route.fulfill({
      json: {
        id: "66666666-6666-4666-8666-666666666666",
        name: "Main",
        description: "",
        system_prompt: "",
        tools: [],
        max_steps: 5,
      },
    }),
  );
  await page.route("**/api/py/chat/models", (route) =>
    route.fulfill({ json: [model] }),
  );
  await page.route("**/api/py/tools/active", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/py/agents/sub-agents**", (route) =>
    route.fulfill({
      json: { items: [research, offline], total: 2, page: 1, page_size: 10 },
    }),
  );
}

async function openStatus(page: Page) {
  await page
    .getByRole("button", { name: /^(Chat status|Context usage)/ })
    .click({ timeout: 15_000 });
}

test("chooses General chat sub-agents with their fixed models and recovers a conflict", async ({
  page,
}) => {
  await mockSettings(page);
  let set: GeneralSubAgents = {
    revision: 1,
    agents: [],
    delegation_allowed: true,
  };
  let conflict = true;
  const writes: unknown[] = [];
  await page.route(GENERAL, (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      writes.push(body);
      if (conflict) {
        // Another tab saved first.
        conflict = false;
        set = { ...set, revision: 2 };
        return route.fulfill({
          status: 409,
          json: {
            detail: "General chat sub-agents changed; reload and try again",
          },
        });
      }
      expect(body.expected_revision).toBe(set.revision);
      set = {
        ...set,
        revision: set.revision + 1,
        agents: [research, offline].filter((agent) =>
          body.agent_ids.includes(agent.id),
        ),
      };
    }
    return route.fulfill({ json: set });
  });
  await page.goto("/e2e/agent-settings");
  const section = page.getByRole("region", {
    name: "General chat sub-agents",
  });
  await expect(
    section.getByText(
      "None chosen. In General chats the main agent works alone.",
    ),
  ).toBeVisible();

  const open = () =>
    section
      .getByRole("button", { name: "Choose General chat sub-agents" })
      .click();
  await open();
  let dialog = page.getByRole("dialog", { name: "General chat sub-agents" });
  await expect(dialog.getByText("Fixed model: Alpha (Provider)")).toBeVisible();
  await expect(
    dialog.getByRole("checkbox", { name: /Offline helper/ }),
  ).toBeDisabled();
  await expect(dialog.getByText("Its provider is disabled.")).toBeVisible();
  await dialog.getByRole("checkbox", { name: /Researcher/ }).check();
  await dialog.getByRole("button", { name: "Save choices" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "General chat sub-agents changed; reload and try again",
  );
  // The pending choice survives the conflict until the user reloads.
  await expect(
    dialog.getByRole("checkbox", { name: /Researcher/ }),
  ).toBeChecked();
  await dialog.getByRole("button", { name: "Reload current choices" }).click();
  await page.getByRole("button", { name: "Discard changes" }).click();
  dialog = page.getByRole("dialog", { name: "General chat sub-agents" });
  await expect(
    dialog.getByRole("checkbox", { name: /Researcher/ }),
  ).not.toBeChecked();
  await dialog.getByRole("checkbox", { name: /Researcher/ }).check();
  await dialog.getByRole("button", { name: "Save choices" }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes.at(-1)).toEqual({
    agent_ids: [RESEARCH],
    expected_revision: 2,
  });
  await expect(section.getByText("Researcher")).toBeVisible();
  await expect(section.getByText("Available")).toBeVisible();
});

const user: Message = {
  id: "88888888-8888-4888-8888-000000000001",
  role: "user",
  created_at: 0,
  status: "pending",
  content: "Find star catalogues.",
};
const answer: Message = {
  id: "88888888-8888-4888-8888-000000000003",
  role: "assistant",
  created_at: 0,
  status: "completed",
  content: "The researcher found Hipparcos and Gaia.",
  parent_message_id: user.id,
};

async function openGeneralChat(page: Page, set: GeneralSubAgents) {
  await mockDefaultPersonas(page);
  const chat: Chat = {
    info: {
      id: C,
      user_id: "test",
      title: "General delegation",
      created_at: 0,
      updated_at: 0,
      selected_model_id: M,
      selected_model: model,
      model_revision: 1,
      project_id: null,
    },
    messages: [],
  };
  await page.route("**/api/py/chat/models", (route) =>
    route.fulfill({ json: [model] }),
  );
  await page.route(GENERAL, (route) => route.fulfill({ json: set }));
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
  await page.route(`**/api/py/chat/${C}/message`, (route) => {
    chat.messages = [user];
    return route.fulfill({ json: user });
  });
  await page.route(`**/api/py/chat/${C}`, (route) =>
    route.fulfill({ json: chat }),
  );
  const transport: { socket?: WebSocketRoute } = {};
  await page.routeWebSocket(`**/api/py/chat/stream/${C}?**`, (socket) => {
    transport.socket = socket;
    socket.send(JSON.stringify({ type: "status", is_processing: false }));
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === "ping")
        socket.send(JSON.stringify({ type: "pong" }));
      if (message.type !== "resume") return;
      // The fake provider: the main agent delegates to the Researcher.
      const packet = (event: object) =>
        JSON.stringify({
          type: "sub_agent",
          execution_id: "general-execution",
          parent_execution_id: null,
          sub_agent_id: RESEARCH,
          sub_agent_name: "Researcher",
          model_id: M,
          model_name: "Alpha",
          depth: 1,
          event,
        });
      socket.send(JSON.stringify({ type: "status", is_processing: true }));
      socket.send(JSON.stringify({ type: "start" }));
      socket.send(packet({ type: "start" }));
      socket.send(packet({ type: "delta", content: "Checking catalogues" }));
      socket.send(packet({ type: "complete", content: "Hipparcos and Gaia" }));
      chat.messages = [{ ...user, status: "completed" }, answer];
      setTimeout(() => {
        socket.send(
          JSON.stringify({ type: "complete", last_messages: chat.messages }),
        );
        socket.send(JSON.stringify({ type: "status", is_processing: false }));
      }, 300);
    });
  });
  await page.goto("/e2e/chat-model-session");
  await expect.poll(() => transport.socket).toBeDefined();
}

test("delegates from a General chat when the composer shows sub-agents available", async ({
  page,
}) => {
  await openGeneralChat(page, {
    revision: 2,
    agents: [research],
    delegation_allowed: true,
  });
  // The composer's status popover lists the General set (US-73.2).
  await openStatus(page);
  const indicator = page.getByRole("link", {
    name: /^Sub-agents available: Researcher/,
  });
  await expect(indicator).toBeVisible({ timeout: 15_000 });
  await expect(indicator).toHaveAttribute(
    "href",
    "/settings?t=user&setting=agents",
  );
  await page.keyboard.press("Escape");

  await page
    .getByLabel("Message", { exact: true })
    .fill("Find star catalogues.");
  await page.getByRole("button", { name: "Send message" }).click();
  const live = page.getByRole("region", { name: "Sub-agent activity" });
  await expect(live).toContainText("Researcher");
  await expect(
    page.getByText("The researcher found Hipparcos and Gaia."),
  ).toBeVisible();
});

test("explains when a chosen General set can't delegate", async ({ page }) => {
  await openGeneralChat(page, {
    revision: 2,
    agents: [research],
    delegation_allowed: false,
  });
  await openStatus(page);
  await expect(
    page.getByRole("link", { name: /^Sub-agents unavailable\./ }),
  ).toHaveAccessibleName(/administrator has turned sub-agents off/, {
    timeout: 15_000,
  });
});
