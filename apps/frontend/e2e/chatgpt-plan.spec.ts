import { randomUUID } from "node:crypto";
import { measure } from "./support/contrast";
import { mockDefaultPersonas } from "./support/personas";
import { expect, test, type Page, type WebSocketRoute } from "./support/test";
import { themes } from "./support/theme-matrix";
import type { Chat, ChatModelChoice } from "../src/lib/client";

// US-49.4: ChatGPT plan label, limits and recovery against local doubles: a
// routed OAuth consent page stands in for auth.openai.com, and the routed chat
// socket stands in for the plan's Responses stream.
const M = "11111111-1111-4111-8111-111111111111";
const C = "77777777-7777-4777-8777-777777777777";
const MANAGE_USAGE = "https://chatgpt.com/settings/usage";

const plan: ChatModelChoice = {
  id: M,
  name: "gpt-plan",
  display_name: "GPT Plan",
  provider_id: "33333333-3333-4333-8333-333333333333",
  provider_name: "ChatGPT",
  provider_type: "chatgpt",
  available: true,
  supports_tools: true,
};
const paused: ChatModelChoice = {
  ...plan,
  available: false,
  unavailable_code: "chatgpt_plan_usage_limit",
  unavailable_reason:
    "Usage limit reached. Review your plan or this app's limit in ChatGPT settings.",
};

async function openPlanChat(page: Page, state: { model: ChatModelChoice }) {
  await mockDefaultPersonas(page);
  const chat = (): Chat => ({
    info: {
      id: C,
      user_id: "test",
      title: "Plan chat",
      created_at: 0,
      updated_at: 0,
      selected_model_id: M,
      selected_model: state.model,
      model_revision: 1,
      project_id: null,
    },
    messages: [
      {
        id: "88888888-8888-4888-8888-000000000001",
        role: "user",
        created_at: 0,
        status: "completed",
        content: "Plan question",
      },
    ],
  });
  await page.route("**/api/py/chat/models", (route) =>
    route.fulfill({ json: [state.model] }),
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
    route.fulfill({ json: chat() }),
  );
  const transport: { socket?: WebSocketRoute } = {};
  await page.routeWebSocket(`**/api/py/chat/stream/${C}?**`, (socket) => {
    transport.socket = socket;
    socket.send(JSON.stringify({ type: "status", is_processing: false }));
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type === "ping")
        socket.send(JSON.stringify({ type: "pong" }));
    });
  });
  await page.goto("/e2e/chat-model-session");
  await expect.poll(() => transport.socket).toBeDefined();
  return transport.socket!;
}

async function ratio(
  page: Page,
  locator: ReturnType<Page["locator"]>,
  id: string,
) {
  await locator.evaluate(
    (node, id) => node.setAttribute("data-contrast", id),
    id,
  );
  return (await measure(page, id)).ratio;
}

for (const theme of themes) {
  test(`${theme}: plan label and usage-limit recovery stay readable and keyboard reachable`, async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: "asterism-custom-theme-name",
        value: theme,
        url: "http://localhost:3100",
      },
    ]);
    await page.setViewportSize({ width: 1280, height: 900 });
    const socket = await openPlanChat(page, { model: plan });

    const label = page
      .getByRole("note")
      .filter({ hasText: "Using ChatGPT plan" });
    await expect(label).toBeVisible();
    await expect(page.getByLabel("Chat model")).toContainText("GPT Plan");
    const manage = label.getByRole("link", { name: /Manage usage/ });
    await expect(manage).toHaveAttribute("href", MANAGE_USAGE);
    await expect(manage).toHaveAttribute("target", "_blank");
    expect(
      await ratio(page, label.getByText("Using ChatGPT plan"), "plan-label"),
    ).toBeGreaterThanOrEqual(4.5);

    // The plan stream fails with a usage limit after the request starts.
    socket.send(JSON.stringify({ type: "status", is_processing: true }));
    socket.send(
      JSON.stringify({
        type: "error",
        content:
          "Usage limit reached. Review your plan or this app's limit in ChatGPT settings.",
        error_code: "chatgpt_plan_usage_limit",
      }),
    );
    const notice = page.getByRole("alert", { name: "Usage limit reached" });
    await expect(notice).toBeVisible();
    const primary = notice.getByRole("link", { name: /Manage usage/ });
    await expect(primary).toHaveAttribute("href", MANAGE_USAGE);
    await expect(
      notice.getByRole("button", { name: "Try my plan again" }),
    ).toBeVisible();
    expect(
      await ratio(page, notice.getByText(/Review your plan/), "plan-body"),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      await ratio(page, notice.getByText("Usage limit reached"), "plan-title"),
    ).toBeGreaterThanOrEqual(4.5);

    // Keyboard order keeps Manage usage first among the recovery actions.
    await primary.focus();
    await expect(primary).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      notice.getByRole("button", { name: "Try my plan again" }),
    ).toBeFocused();
  });
}

test("a paused plan resumes only on the user's explicit retry", async ({
  page,
}) => {
  const state = { model: paused };
  const resumes: string[] = [];
  await page.route("**/api/py/chatgpt/connection/resume", (route) => {
    resumes.push(route.request().method());
    state.model = plan;
    return route.fulfill({
      json: {
        policy_enabled: true,
        status: "connected",
        usage_paused: false,
        model_count: 1,
      },
    });
  });
  await openPlanChat(page, state);

  const notice = page.getByRole("alert", { name: "Usage limit reached" });
  await expect(notice).toBeVisible();
  await expect(
    page.getByRole("note").filter({ hasText: "Using ChatGPT plan" }),
  ).toHaveCount(0);
  expect(resumes).toEqual([]);

  await notice.getByRole("button", { name: "Try my plan again" }).click();

  await expect.poll(() => resumes).toEqual(["POST"]);
  await expect(
    page.getByRole("note").filter({ hasText: "Using ChatGPT plan" }),
  ).toBeVisible();
  await expect(
    page.getByRole("alert", { name: "Usage limit reached" }),
  ).toHaveCount(0);
});

for (const code of [
  "chatgpt_plan_reauthorization_required",
  "chatgpt_plan_temporarily_unavailable",
]) {
  test(`live ${code} errors show their recovery`, async ({ page }) => {
    const socket = await openPlanChat(page, { model: plan });
    socket.send(
      JSON.stringify({
        type: "error",
        content: "Plan failed",
        error_code: code,
      }),
    );
    if (code.endsWith("reauthorization_required")) {
      const notice = page.getByRole("alert", {
        name: "Sign in to ChatGPT again",
      });
      await expect(
        notice.getByRole("link", { name: "Connect ChatGPT" }),
      ).toHaveAttribute("href", "/settings?t=user&setting=chatgpt");
    } else {
      const notice = page.getByRole("alert", {
        name: "ChatGPT plan temporarily unavailable",
      });
      await expect(notice).toBeVisible();
      await notice.getByRole("button", { name: "Dismiss" }).click();
      await expect(notice).toHaveCount(0);
    }
  });
}

for (const width of [1280, 320]) {
  test(`continues with ChatGPT through the OAuth double and shows the first-use notice once at ${width}px`, async ({
    context,
    page,
  }) => {
    test.skip(
      process.env.ASTERISM_ISOLATED_E2E !== "true",
      "Requires isolated authentication and storage",
    );
    test.setTimeout(90_000);
    const email = `${randomUUID()}@example.test`;
    const signup = await context.request.post(
      `/api/auth/sign-up/email?adminKey=${encodeURIComponent(process.env.ADMIN_PASSPHRASE!)}&role=user`,
      { data: { name: "Plan tester", email, password: "Plan-test-4974!" } },
    );
    expect(signup.ok()).toBeTruthy();
    const user = (await signup.json()).user;
    const provision = await context.request.post("/api/py/users/", {
      data: { user_id: user.id, system_key: process.env.SYSTEM_KEY },
    });
    expect(provision.ok()).toBeTruthy();

    let connection: Record<string, unknown> = {
      policy_enabled: true,
      status: null,
      model_count: 0,
    };
    const dismissed: string[] = [];
    await page.route("**/api/py/chatgpt/connection", (route) =>
      route.fulfill({ json: connection }),
    );
    await page.route("**/api/py/chatgpt/connection/authorize", (route) =>
      route.fulfill({
        json: {
          authorization_url:
            "https://auth.openai.com/api/accounts/authorize?client_id=dynamic_agent_client&state=e2e-state",
        },
      }),
    );
    await page.route("**/api/py/chatgpt/connection/notice", (route) => {
      dismissed.push(route.request().method());
      connection = { ...connection, notice_pending: false };
      return route.fulfill({ json: connection });
    });
    // OAuth double: consent, then the loopback callback's redirect back to Settings.
    await page.route("https://auth.openai.com/**", (route) => {
      connection = {
        policy_enabled: true,
        status: "connected",
        email: "plan@example.test",
        plan_usage_enabled: true,
        model_count: 2,
        notice_pending: true,
      };
      return route.fulfill({
        contentType: "text/html",
        body: `<main><h1>Allow Asterism?</h1><a href="http://localhost:3100/settings?t=user&setting=chatgpt&chatgpt=connected">Allow</a></main>`,
      });
    });

    await page.setViewportSize({ width, height: width === 320 ? 600 : 800 });
    await page.goto("/settings?t=user&setting=chatgpt");
    await expect(
      page.getByText(/must run on the same machine as Asterism/),
    ).toBeVisible();
    await page.getByRole("button", { name: "Continue with ChatGPT" }).click();
    await page.getByRole("link", { name: "Allow" }).click();

    const dialog = page.getByRole("alertdialog", {
      name: "You're using your ChatGPT plan",
    });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(
      "Eligible usage in this app uses your ChatGPT plan.",
    );
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    expect(dismissed).toEqual(["POST"]);
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Your ChatGPT plan is connected." }),
    ).toBeVisible();
    await expect(page.getByText("2 plan models available.")).toBeVisible();

    await page.reload();
    await expect(
      page.getByText("Connected as plan@example.test"),
    ).toBeVisible();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  });
}
