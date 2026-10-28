import { expect, Page, test } from "./support/test";

type Packet = Record<string, unknown>;

const subAgent = (
  executionId: string,
  event: Packet,
  {
    name = `Agent ${executionId}`,
    parent = null,
    model = "Gamma",
    depth = parent ? 2 : 1,
  }: {
    name?: string;
    parent?: string | null;
    model?: string | null;
    depth?: number;
  } = {},
) => ({
  type: "sub_agent",
  execution_id: executionId,
  parent_execution_id: parent,
  sub_agent_id: `agent-${executionId}`,
  sub_agent_name: name,
  model_id: model ? "44444444-4444-4444-8444-444444444444" : null,
  model_name: model,
  depth,
  event,
});

/** Routes the harness socket; returns a sender for scripted packets. */
async function openHarness(page: Page) {
  const pending: string[] = [];
  let send: ((packet: string) => void) | null = null;
  await page.routeWebSocket(/\/api\/py\/chat\/stream\//, (socket) => {
    socket.onMessage((message) => {
      if (JSON.parse(message.toString()).type !== "chat") return;
      send = (packet) => socket.send(packet);
      pending.splice(0).forEach(send);
    });
  });
  await page.goto("/e2e/sub-agent");
  await page.getByRole("button", { name: "Delegate task" }).click();
  await expect.poll(() => send !== null).toBe(true);
  return (...packets: Packet[]) =>
    packets.forEach((packet) => send!(JSON.stringify(packet)));
}

const graph = (page: Page) => page.locator('[data-slot="agent-constellation"]');
const node = (page: Page, id: string) =>
  graph(page).locator(`[data-node-id="${id}"]`);
const core = (page: Page, id: string) =>
  node(page, id).locator("circle").last();

test("moves nodes from live flare to settled star or destructive", async ({
  page,
}) => {
  const send = await openHarness(page);
  send(
    { type: "start" },
    subAgent("lead", { type: "start" }, { name: "Researcher" }),
    subAgent(
      "child",
      { type: "start" },
      { name: "Fact checker", parent: "lead" },
    ),
  );
  await expect(node(page, "lead")).toHaveAttribute("data-state", "running");
  await expect(node(page, "lead")).toContainText("Researcher");
  await expect(node(page, "lead")).toContainText("Gamma");
  await expect(node(page, "main")).toHaveAttribute("data-state", "running");
  // The nested delegation hangs off its parent, one band lower.
  const edge = graph(page).locator(
    '[data-slot="constellation-edge"][data-to="child"]',
  );
  await expect(edge).toHaveAttribute("data-from", "lead");
  const leadBox = (await node(page, "lead").boundingBox())!;
  const childBox = (await node(page, "child").boundingBox())!;
  expect(childBox.y).toBeGreaterThan(leadBox.y);
  // Atlas flare is #E0A526.
  await expect(core(page, "lead")).toHaveCSS("fill", "rgb(224, 165, 38)");

  send(
    subAgent("child", { type: "error", content: "Provider timed out" }),
    subAgent("lead", {
      type: "complete",
      content: "Research complete",
      thinking: "",
    }),
  );
  await expect(node(page, "child")).toHaveAttribute("data-state", "error");
  await expect(node(page, "lead")).toHaveAttribute("data-state", "completed");
  await expect(node(page, "main")).toHaveAttribute("data-state", "completed");
  const star = await page.evaluate(() =>
    getComputedStyle(document.body).getPropertyValue("--primary").trim(),
  );
  expect(star.toLowerCase()).toBe("#3b5bdb");
  await expect(core(page, "lead")).toHaveCSS("fill", "rgb(59, 91, 219)");
  await expect(edge).toHaveAttribute("data-state", "error");
  await expect(graph(page).locator(".animate-pulse")).toHaveCount(0);
  await expect(
    page.getByRole("img", {
      name: "Delegation graph: main agent and 2 sub-agents, 1 failed",
    }),
  ).toBeVisible();
});

for (const width of [320, 1280]) {
  test(`fits many agents at ${width}px with an overflow node`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const send = await openHarness(page);
    send(
      ...Array.from({ length: 12 }, (_, index) =>
        subAgent(
          `top${index}`,
          { type: "start" },
          {
            name: `Specialist number ${index} with a long name`,
          },
        ),
      ),
      ...Array.from({ length: 8 }, (_, index) =>
        subAgent(`deep${index}`, { type: "start" }, { parent: "top0" }),
      ),
    );
    const overflow = graph(page).locator('[data-kind="overflow"]');
    await expect(overflow).toContainText("+5 more");
    await expect(overflow).toContainText("5 running");
    await expect(graph(page).locator('[data-kind="sub-agent"]')).toHaveCount(
      15,
    );
    await expect(graph(page)).toHaveAttribute(
      "data-columns",
      width === 320 ? "2" : "6",
    );

    const bounds = (await graph(page).boundingBox())!;
    for (const box of await graph(page)
      .locator('[data-slot="constellation-node"]')
      .evaluateAll((nodes) =>
        nodes.map((item) => item.getBoundingClientRect().toJSON()),
      )) {
      expect(box.left).toBeGreaterThanOrEqual(bounds.x - 1);
      expect(box.right).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

const themes = ["atlas", "night-atlas", "dracula"];
const viewports = [
  { name: "desktop", width: 1100, height: 800 },
  { name: "mobile", width: 390, height: 800 },
];
for (const theme of themes) {
  for (const viewport of viewports) {
    test(`${theme}: constellation at ${viewport.name}`, async ({
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
      await page.setViewportSize(viewport);
      const send = await openHarness(page);
      send(
        subAgent("a", { type: "start" }, { name: "Researcher" }),
        subAgent("b", { type: "start" }, { name: "Writer", model: "Delta" }),
        subAgent("c", { type: "start" }, { name: "Checker", parent: "a" }),
        subAgent(
          "b",
          { type: "complete", content: "Done", thinking: "" },
          { name: "Writer", model: "Delta" },
        ),
        subAgent("c", { type: "error", content: "Timed out" }),
      );
      await expect(node(page, "c")).toHaveAttribute("data-state", "error");
      await expect(graph(page)).toHaveScreenshot(
        `constellation-${theme}-${viewport.name}.png`,
      );
    });
  }
}
