import { expect, Page, test } from "@playwright/test";

const assistantMessage = (content: string) => ({
  role: "assistant",
  content,
  token_count: 12,
  id: "22222222-2222-4222-8222-222222222222",
  status: "completed",
  created_at: 1,
});

const subAgentPacket = (
  executionId: string,
  event: Record<string, unknown>,
) => ({
  type: "sub_agent",
  execution_id: executionId,
  sub_agent_id: "33333333-3333-4333-8333-333333333333",
  sub_agent_name: "Researcher",
  depth: 1,
  event,
});

async function routeDelegationStream(
  page: Page,
  events: Record<string, unknown>[],
) {
  await page.routeWebSocket(/\/api\/py\/chat\/stream\//, (socket) => {
    socket.onMessage((message) => {
      const parsed = JSON.parse(message.toString());
      if (parsed.type !== "chat") return;
      events.forEach((event, index) => {
        setTimeout(() => socket.send(JSON.stringify(event)), index * 20);
      });
    });
  });
}

test("shows delegated progress and the final parent response", async ({ page }) => {
  await routeDelegationStream(page, [
    { type: "start" },
    subAgentPacket("execution-success", { type: "start" }),
    subAgentPacket("execution-success", {
      type: "delta",
      content: "Found two relevant sources",
      thinking: "Comparing source dates",
    }),
    subAgentPacket("execution-success", {
      type: "tool_call",
      tool_calls: [
        {
          id: "tool-1",
          type: "function",
          function: { name: "web_search", arguments: '{"q":"asterism"}' },
        },
      ],
    }),
    subAgentPacket("execution-success", {
      type: "complete",
      content: "Delegated research complete",
      thinking: "Comparing source dates",
    }),
    {
      type: "complete",
      last_messages: [assistantMessage("Parent synthesized the research")],
    },
  ]);

  await page.goto("/e2e/sub-agent");
  await page.getByRole("button", { name: "Delegate task" }).click();

  const activity = page.getByTestId("sub-agent-execution-success");
  await expect(activity).toContainText("Researcher");
  await expect(activity).toContainText("Delegated research complete");
  await expect(activity).toContainText("web_search");
  await expect(activity).toContainText("Completed");
  await expect(page.getByRole("region", { name: "Parent response" })).toHaveText(
    "Parent synthesized the research",
  );
});

test("shows a delegated timeout while allowing a parent response", async ({ page }) => {
  await routeDelegationStream(page, [
    { type: "start" },
    subAgentPacket("execution-timeout", { type: "start" }),
    subAgentPacket("execution-timeout", {
      type: "error",
      content: "Sub-agent provider timed out after 120 seconds",
    }),
    {
      type: "complete",
      last_messages: [assistantMessage("I could not complete the delegated research")],
    },
  ]);

  await page.goto("/e2e/sub-agent");
  await page.getByRole("button", { name: "Delegate task" }).click();

  const activity = page.getByTestId("sub-agent-execution-timeout");
  await expect(activity).toContainText("Failed");
  await expect(activity.getByRole("alert")).toContainText("timed out");
  await expect(page.getByRole("region", { name: "Parent response" })).toHaveText(
    "I could not complete the delegated research",
  );
});
