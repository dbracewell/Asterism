import { expect, test } from "./support/test";
const P = "11111111-1111-4111-8111-111111111111";
const Q = "22222222-2222-4222-8222-222222222222";
const R = "33333333-3333-4333-8333-333333333333";
const S = "44444444-4444-4444-8444-444444444444";
const M = "55555555-5555-4555-8555-555555555555";

test("selects workers separately for two projects, retains unavailable bindings, and recovers selection conflicts", async ({
  page,
}) => {
  let workers = [
    { id: R, name: "Research", model_id: M, model_available: true },
    { id: S, name: "Reviewer", model_id: M, model_available: true },
  ];
  const state: Record<string, { revision: number; ids: string[] }> = {
    [P]: { revision: 3, ids: [] },
    [Q]: { revision: 7, ids: [S] },
  };
  let conflict = false;
  const changes: Array<{ projectId: string; method: string; body: object }> =
    [];
  await page.route("**/api/py/chat/models", (route) =>
    route.fulfill({
      json: [
        {
          id: M,
          name: "Fixed model",
          provider_name: "Provider",
          provider_type: "generic_openai",
          available: true,
        },
      ],
    }),
  );
  await page.route("**/api/py/projects/**", (route) => {
    const url = new URL(route.request().url());
    const parts = url.pathname.split("/");
    const projectId = parts[4];
    const entry = state[projectId];
    if (!entry)
      return route.fulfill({
        json: { projects: [], total: 0, page: 1, page_size: 20 },
      });
    const method = route.request().method();
    if (method === "POST" || method === "DELETE") {
      const body = route.request().postDataJSON();
      changes.push({ projectId, method, body });
      if (conflict) {
        conflict = false;
        entry.revision++;
        return route.fulfill({
          status: 409,
          json: { detail: "Project selection changed" },
        });
      }
      expect(body.expected_context_revision).toBe(entry.revision);
      entry.ids =
        method === "POST"
          ? [...new Set([...entry.ids, ...body.agent_ids])]
          : entry.ids.filter((id) => !body.agent_ids.includes(id));
      entry.revision++;
      return route.fulfill({
        json: {
          context_revision: entry.revision,
          changed_agent_ids: body.agent_ids,
          unchanged_agent_ids: [],
        },
      });
    }
    if (
      url.pathname.endsWith("sub-agents") ||
      url.pathname.endsWith("sub-agent-candidates")
    ) {
      const selected = url.pathname.endsWith("sub-agents");
      const agents = workers.filter(
        (worker) => entry.ids.includes(worker.id) === selected,
      );
      return route.fulfill({
        json: {
          agents,
          total: agents.length,
          page: 1,
          page_size: 10,
          context_revision: entry.revision,
        },
      });
    }
    return route.fulfill({
      json: {
        id: projectId,
        name: projectId === P ? "Research project" : "Review project",
        description: "",
        system_prompt: "",
        context_revision: entry.revision,
        created_at: 0,
        updated_at: 0,
      },
    });
  });
  await page.goto(`/e2e/projects?view=settings&projectId=${P}`);
  const panel = page.getByRole("region", {
    name: "Project sub-agents",
    exact: true,
  });
  await expect(panel.getByText("No selected sub-agents")).toBeVisible();
  await panel
    .getByRole("button", { name: "Select Research", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "Deselect Research" }),
  ).toBeVisible();
  await expect(
    panel.getByText("Fixed model: Fixed model (Provider)").first(),
  ).toBeVisible();
  await page.goto(`/e2e/projects?view=settings&projectId=${Q}`);
  await expect(
    panel.getByRole("button", { name: "Deselect Reviewer" }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Select Research", exact: true }),
  ).toBeVisible();
  await page.goto(`/e2e/projects?view=settings&projectId=${P}`);
  conflict = true;
  await panel.getByRole("button", { name: "Deselect Research" }).click();
  await expect(panel.getByRole("alert")).toContainText(
    "Project selection changed",
  );
  await expect(
    panel.getByRole("button", { name: "Deselect Research" }),
  ).toBeDisabled();
  await panel
    .getByRole("button", { name: "Reload sub-agent selections" })
    .click();
  await expect(
    panel.getByRole("button", { name: "Deselect Research" }),
  ).toBeEnabled();
  workers[0].model_available = false;
  await page.reload();
  await expect(panel.getByText("Model unavailable")).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Deselect Research" }),
  ).toBeEnabled();
  await page.screenshot({
    path: "test-results/project-agents-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/project-agents-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await panel.getByRole("button", { name: "Deselect Research" }).click();
  await expect(panel.getByText("No selected sub-agents")).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Select Research", exact: true }),
  ).toBeDisabled();
  expect(state[Q].ids).toEqual([S]);
  workers = workers.filter((worker) => worker.id !== S);
  state[Q].ids = [];
  state[Q].revision++;
  await page.goto(`/e2e/projects?view=settings&projectId=${Q}`);
  await expect(panel.getByText("No selected sub-agents")).toBeVisible();
  await expect(panel.getByRole("button", { name: /Reviewer/ })).toHaveCount(0);
  expect(changes.every((change) => change.projectId === P)).toBe(true);
  expect(changes[0].body).toEqual({
    agent_ids: [R],
    expected_context_revision: 3,
  });
});
