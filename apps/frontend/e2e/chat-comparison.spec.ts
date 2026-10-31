import AxeBuilder from "@axe-core/playwright";
import { defaultPersonaProvenance } from "../src/test/personas";
import { standardLearningMode } from "../src/test/learning-modes";
import type {
  Chat,
  ChatComparison,
  ChatModelChoice,
  Message,
  MessageExecution,
} from "../src/lib/client";
import { mockDefaultPersonas } from "./support/personas";
import { expect, test, type Page } from "./support/test";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "77777777-7777-4777-8777-777777777777";
const U = "88888888-8888-4888-8888-888888888888";
const R = "99999999-9999-4999-8999-999999999999";
const U2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const R2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CMP = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const model = (id: string, name: string): ChatModelChoice => ({
  id,
  name,
  provider_id: "33333333-3333-4333-8333-333333333333",
  provider_name: "Provider",
  provider_type: "generic_openai",
  available: true,
  supports_vision: false,
  supports_tools: true,
  context_window: 8192,
});
const models = [model(A, "Alpha"), model(B, "Beta")];
const execution = (target: ChatModelChoice): MessageExecution => ({
  persona: defaultPersonaProvenance,
  learning_mode: standardLearningMode,
  id: "44444444-4444-4444-8444-444444444444",
  request_message_id: U,
  model_revision: 1,
  model: target,
  configuration: {
    id: "66666666-6666-4666-8666-666666666666",
    name: "Main",
    description: "",
    system_prompt: "Be precise",
    config_revision: 1,
  },
});

const turn: Message = {
  id: U,
  role: "user",
  created_at: 0,
  status: "completed",
  content: "Explain tides",
};
const alphaAnswer: Message = {
  id: R,
  role: "assistant",
  created_at: 0,
  status: "completed",
  content: "Alpha says the moon pulls the oceans.",
  parent_message_id: U,
  execution: execution(models[0]),
  input_tokens: 40,
  output_tokens: 12,
  total_tokens: 52,
};
const betaAnswer: Message = {
  ...alphaAnswer,
  id: R2,
  parent_message_id: U2,
  content: "Beta adds the sun's smaller pull.",
  execution: execution(models[1]),
  input_tokens: 41,
  output_tokens: 15,
  total_tokens: 56,
};
const column = (
  index: number,
  request: Message,
  replies: Message[],
  status: "pending" | "completed",
) => ({
  index,
  request: {
    ...request,
    comparison_id: CMP,
    comparison_index: index,
    target_model_id: models[index].id,
  },
  replies,
  model: models[index],
  status,
  input_tokens: replies.reduce(
    (sum, reply) => sum + (reply.input_tokens ?? 0),
    0,
  ),
  output_tokens: replies.reduce(
    (sum, reply) => sum + (reply.output_tokens ?? 0),
    0,
  ),
  total_tokens: replies.reduce(
    (sum, reply) => sum + (reply.total_tokens ?? 0),
    0,
  ),
  generation_duration_ms: 0,
});

async function mockChat(page: Page) {
  const calls: { compare: unknown[]; activate: unknown[]; send: unknown[] } = {
    compare: [],
    activate: [],
    send: [],
  };
  const state = { compared: false, betaDone: false, active: 0 };
  const info: Chat["info"] = {
    id: C,
    user_id: "test",
    title: "Tides",
    created_at: 0,
    updated_at: 0,
    selected_model_id: A,
    selected_model: models[0],
    model_revision: 1,
    project_id: null,
  };
  const comparison = (): ChatComparison => ({
    id: CMP,
    chat_id: C,
    parent_message_id: null,
    active_index: state.active,
    columns: [
      column(0, turn, [alphaAnswer], "completed"),
      column(
        1,
        { ...turn, id: U2, status: state.betaDone ? "completed" : "pending" },
        state.betaDone ? [betaAnswer] : [],
        state.betaDone ? "completed" : "pending",
      ),
    ],
  });
  const chat = (): Chat => {
    if (!state.compared) return { info, messages: [turn, alphaAnswer] };
    const active = comparison().columns[state.active];
    return { info, messages: [active.request, ...(active.replies ?? [])] };
  };

  await mockDefaultPersonas(page);
  await page.route("**/api/py/chat/models", (route) =>
    route.fulfill({ json: models }),
  );
  await page.route(`**/api/py/chat/${C}/files/context`, (route) =>
    route.fulfill({
      json: {
        chat_id: C,
        project_id: null,
        allowed_file_ids: [],
        local_file_ids: [],
        project_file_ids: [],
        unavailable_file_ids: [],
        files: [],
      },
    }),
  );
  await page.route(`**/api/py/chat/${C}`, (route) =>
    route.fulfill({ json: chat() }),
  );
  await page.route(`**/api/py/chat/${C}/message/${U}/compare`, (route) => {
    calls.compare.push(route.request().postDataJSON());
    state.compared = true;
    return route.fulfill({ json: comparison() });
  });
  await page.route(`**/api/py/chat/${C}/comparisons/${CMP}`, (route) =>
    route.fulfill({ json: comparison() }),
  );
  await page.route(`**/api/py/chat/${C}/comparisons/${CMP}/active`, (route) => {
    calls.activate.push(route.request().postDataJSON());
    state.active = 1;
    return route.fulfill({ json: comparison() });
  });
  await page.route(`**/api/py/chat/${C}/message`, (route) => {
    calls.send.push(route.request().postDataJSON());
    return route.fulfill({ status: 409, json: { detail: "Stop here" } });
  });

  let finishBeta: (() => void) | undefined;
  await page.routeWebSocket(`**/api/py/chat/stream/${C}?**`, (socket) => {
    socket.send(JSON.stringify({ type: "status", is_processing: false }));
    socket.onMessage((raw) => {
      const request = JSON.parse(String(raw));
      if (request.type === "ping") {
        socket.send(JSON.stringify({ type: "pong" }));
        return;
      }
      if (request.type !== "resume" || !state.compared || state.betaDone)
        return;
      const tag = { comparison: { id: CMP, column_id: U2 } };
      socket.send(JSON.stringify({ type: "status", is_processing: true }));
      // Like a provider without its own start event: an untagged start
      // followed by tagged packets must still stream into the column only.
      socket.send(JSON.stringify({ type: "start" }));
      socket.send(
        JSON.stringify({
          type: "delta",
          content: "Beta adds the sun",
          thinking: "",
          ...tag,
        }),
      );
      finishBeta = () => {
        state.betaDone = true;
        socket.send(
          JSON.stringify({
            type: "complete",
            last_messages: [comparison().columns[1].request, betaAnswer],
            ...tag,
          }),
        );
        socket.send(JSON.stringify({ type: "status", is_processing: false }));
      };
    });
  });
  return { calls, finish: () => finishBeta?.() };
}

for (const [width, height] of [
  [1280, 800],
  [390, 844],
]) {
  test(`compares an answer with another model and continues from it at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const mock = await mockChat(page);
    await page.goto("/e2e/chat-model-session");

    const answer = page.getByRole("article", { name: "Assistant message" });
    await expect(answer).toContainText("Alpha says", { timeout: 15_000 });
    await answer.hover();
    await page
      .getByRole("button", { name: "Compare with other models" })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Compare with other models",
    });
    // The answered model is already column 1, so only Beta is offered.
    await expect(dialog.getByLabel("Alpha")).toHaveCount(0);
    await dialog.getByLabel("Beta").check();
    await dialog.getByRole("button", { name: "Compare" }).click();
    await expect(dialog).toBeHidden();
    expect(mock.calls.compare).toEqual([
      { request_id: expect.any(String), targets: [{ model_id: B }] },
    ]);

    const block = page.getByRole("region", {
      name: "Comparison of 2 answers",
    });
    const alpha = block.getByRole("article", { name: "Alpha" });
    const beta = block.getByRole("article", { name: "Beta" });
    await expect(alpha).toContainText("Alpha says the moon");
    await expect(alpha.getByText("Continuing here")).toBeVisible();
    await expect(alpha).toContainText("40 in · 12 out");
    // The tagged run streams into Beta's column, not the transcript tail.
    await expect(beta).toContainText("Beta adds the sun");
    await expect(beta.getByText("Answering…")).toBeVisible();
    await expect(alpha).not.toContainText("Beta adds");

    const outsideBlock = page.locator(
      '[aria-label="Conversation history"] article[data-role="assistant"]:not([data-slot="comparison"] *)',
    );
    await expect(outsideBlock).toHaveCount(0);

    mock.finish();
    await expect(beta).toContainText("Beta adds the sun's smaller pull.");
    await expect(outsideBlock).toHaveCount(0);
    await expect(beta).toContainText("41 in · 15 out");

    // Side by side when there is room; stacked on narrow screens.
    const [a, b] = [await alpha.boundingBox(), await beta.boundingBox()];
    if (width >= 1000) expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
    else {
      expect(b!.y).toBeGreaterThan(a!.y + a!.height - 1);
      expect(Math.abs(a!.x - b!.x)).toBeLessThan(2);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
    expect(
      (
        await new AxeBuilder({ page })
          .include('[data-slot="comparison"]')
          .analyze()
      ).violations,
    ).toEqual([]);

    await beta.getByRole("button", { name: "Continue from Beta" }).click();
    await expect(beta.getByText("Continuing here")).toBeVisible();
    expect(mock.calls.activate).toEqual([{ index: 1 }]);
    expect(errors).toEqual([]);
  });
}

test("the composer sends to two models, and asks for a second before sending", async ({
  page,
}) => {
  const mock = await mockChat(page);
  await page.goto("/e2e/chat-model-session");
  const input = page.getByLabel("Message", { exact: true });
  await expect(input).toBeEnabled({ timeout: 15_000 });

  await page.getByRole("button", { name: "Compare models" }).click();
  await page.getByLabel("Alpha").check();
  await expect(
    page.getByText("Choose one more model to compare."),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await input.fill("And the sun?");
  await page.getByLabel("Send message").click();
  await expect(page.getByText(/at least two models/)).toBeVisible();
  expect(mock.calls.send).toEqual([]);

  await page
    .getByRole("button", { name: "Compare models (1 selected)" })
    .click();
  await page.getByLabel("Beta").check();
  await page.keyboard.press("Escape");
  await page.getByLabel("Send message").click();
  await expect.poll(() => mock.calls.send.length).toBe(1);
  expect(mock.calls.send[0]).toMatchObject({
    user_prompt: "And the sun?",
    compare: [{ model_id: A }, { model_id: B }],
  });
});
