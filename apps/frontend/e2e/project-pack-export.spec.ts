import { readFile } from "node:fs/promises";
import { expect, test } from "./support/test";

const P = "11111111-1111-4111-8111-111111111111";
const R = "33333333-3333-4333-8333-333333333333";
const list = (items: object[]) => ({
  items,
  total: items.length,
  page: 1,
  page_size: 100,
});
const pack = {
  format: "asterism.team-pack",
  format_version: 1,
  pack: { id: "research-project", version: "1.0.0", name: "Research project" },
  sub_agents: [],
  skills: [],
  templates: [],
  rubrics: [],
  project: null,
};

test("chooses items and downloads a team pack from project settings", async ({
  page,
}) => {
  let body: object | undefined;
  await page.route("**/api/py/skills/**", (route) =>
    route.fulfill({ json: list([]) }),
  );
  await page.route("**/api/py/prompt-templates/**", (route) =>
    route.fulfill({ json: list([]) }),
  );
  await page.route("**/api/py/rubrics/**", (route) =>
    route.fulfill({ json: list([]) }),
  );
  await page.route("**/api/py/chat/models", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/py/projects/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("pack-export")) {
      body = route.request().postDataJSON();
      return route.fulfill({ json: pack });
    }
    if (url.pathname.includes("sub-agent"))
      return route.fulfill({
        json: {
          agents: url.pathname.endsWith("sub-agents")
            ? [{ id: R, name: "Critic", model_id: R, model_available: true }]
            : [],
          total: 1,
          page: 1,
          page_size: 100,
          context_revision: 1,
        },
      });
    return route.fulfill({
      json: {
        id: P,
        name: "Research project",
        description: "",
        system_prompt: "",
        context_revision: 1,
        goal: "",
        goal_target_date: null,
        areas: { study: true, reflections: true, goal: true, sub_agents: true },
        created_at: 0,
        updated_at: 0,
      },
    });
  });
  await page.goto(`/e2e/projects?view=project&tab=settings&projectId=${P}`);
  await page.getByRole("button", { name: "Export team pack" }).click();
  const dialog = page.getByRole("dialog", { name: "Export team pack" });
  await dialog.getByRole("checkbox", { name: "Critic" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: "Download pack" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(
    "research-project-1.0.0.team-pack.json",
  );
  const saved = JSON.parse(await readFile(await download.path(), "utf-8"));
  expect(saved).toEqual(pack);
  expect(body).toMatchObject({
    name: "Research project",
    sub_agent_ids: [R],
    include_project_settings: false,
  });
  await expect(dialog).toBeHidden();
});
