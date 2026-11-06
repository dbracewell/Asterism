import { expect, test } from "./support/test";

const M = "11111111-1111-4111-8111-111111111111";
const review = {
  pack: { id: "team", version: "1.2.0", name: "Research team" },
  sub_agents: [
    {
      key: "researcher",
      name: "Researcher",
      description: "Finds sources.",
      instructions: "Find <b>sources</b>.",
      max_steps: 8,
      generation: {},
      requested_tools: [{ name: "web_search", available: true }],
      model_requirements: { tools: true },
      model_options: [
        { id: M, name: "Chat A", provider_name: "P", unmet_requirements: [] },
      ],
      name_conflict: true,
    },
  ],
  skills: [],
  templates: [],
  rubrics: [],
  project: null,
};

test("reviews a pack file and imports it after explicit choices", async ({
  page,
}) => {
  let body: Record<string, unknown> | undefined;
  await page.route("**/api/py/team-packs/review", (route) =>
    route.fulfill({ json: review }),
  );
  await page.route("**/api/py/team-packs/import", (route) => {
    body = route.request().postDataJSON();
    return route.fulfill({
      json: {
        import_id: M,
        sub_agent_ids: [M],
        skill_ids: [],
        template_ids: [],
        rubric_ids: [],
        project_id: null,
      },
    });
  });
  await page.goto("/e2e/projects?view=import");
  await page.getByLabel("Team pack file").setInputFiles({
    name: "team.team-pack.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"format":"asterism.team-pack"}'),
  });
  await expect(page.getByText("Find <b>sources</b>.")).toBeVisible();
  const confirm = page.getByRole("button", { name: "Import 1 item" });
  await expect(confirm).toBeDisabled();
  await page.getByRole("combobox", { name: "Model for Researcher" }).click();
  await page.getByRole("option", { name: "Chat A (P)" }).click();
  await page.getByLabel("New name for Researcher").fill("Scout");
  await page.getByRole("checkbox", { name: "Allow web_search" }).click();
  await confirm.click();
  await expect(page.getByRole("status")).toContainText("Pack imported.");
  expect(body).toMatchObject({
    source: '{"format":"asterism.team-pack"}',
    sub_agents: [
      {
        key: "researcher",
        include: true,
        name: "Scout",
        model_id: M,
        approved_tools: ["web_search"],
      },
    ],
  });
});
