import { mockLearningModes } from "./support/learning-modes";
import { expect, test } from "./support/test";

const P = "11111111-1111-4111-8111-111111111111";
const R = "22222222-2222-4222-8222-222222222222";
const empty = { items: [], total: 0, page: 1, page_size: 20 };
const spot = {
  root_kind: "card",
  root_id: "33333333-3333-4333-8333-333333333333",
  source_kind: "card",
  source_id: "33333333-3333-4333-8333-333333333333",
  kind: "card",
  prompt: "What is tonicity?",
  outcome: "unclear",
  missed_at: 2,
  container_id: "44444444-4444-4444-8444-444444444444",
  container_title: "Unclear items",
  citations: [],
  topics: [],
};

test("turns one confirmed unclear item into a card that needs practice", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockLearningModes(page);
  const created: unknown[] = [];
  await page.route(
    (url) => url.pathname === `/api/py/projects/${P}`,
    (route) =>
      route.fulfill({
        json: {
          id: P,
          name: "Biology",
          description: "",
          system_prompt: "",
          accent: null,
          context_revision: 1,
          goal: "",
          goal_target_date: null,
          areas: {
            study: true,
            reflections: true,
            goal: true,
            sub_agents: true,
          },
          created_at: 1,
          updated_at: 1,
        },
      }),
  );
  await page.route("**/api/py/projects/?**", (route) =>
    route.fulfill({ json: { projects: [], total: 0, page: 1, page_size: 5 } }),
  );
  await page.route("**/api/py/chat/?**", (route) =>
    route.fulfill({ json: { chats: [], total: 0, page: 1, page_size: 20 } }),
  );
  await page.route(`**/api/py/projects/${P}/files?**`, (route) =>
    route.fulfill({ json: { files: [], total: 0, page: 1, page_size: 50 } }),
  );
  await page.route("**/api/py/files/?**", (route) =>
    route.fulfill({ json: { files: [], total: 0, page: 1, page_size: 50 } }),
  );
  await page.route(`**/api/py/projects/${P}/study/decks?**`, (route) =>
    route.fulfill({ json: empty }),
  );
  await page.route(`**/api/py/projects/${P}/study/summary`, (route) =>
    route.fulfill({ json: { deck_count: 0, card_count: 0, due_count: 0 } }),
  );
  await page.route(`**/api/py/projects/${P}/study/quizzes?**`, (route) =>
    route.fulfill({ json: empty }),
  );
  await page.route(`**/api/py/projects/${P}/study/notes?**`, (route) =>
    route.fulfill({ json: empty }),
  );
  await page.route(`**/api/py/projects/${P}/study/progress`, (route) =>
    route.fulfill({
      json: {
        topics: [],
        weak_spots: created.length
          ? { items: [spot], total: 1 }
          : { items: [], total: 0 },
        unclear: {
          items: [
            ...(created.length
              ? []
              : [
                  {
                    reflection_id: R,
                    chat_id: null,
                    reflected_at: 1_700_000_000,
                    text: "Tonicity",
                  },
                ]),
            {
              reflection_id: R,
              chat_id: null,
              reflected_at: 1_700_000_000,
              text: "Why cells burst",
            },
          ],
          total: created.length ? 1 : 2,
        },
        computed_at: 1,
      },
    }),
  );
  await page.route("**/api/py/reflections/?**", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: R,
            project_id: P,
            chat_id: null,
            learned: "Osmosis moves water.",
            unclear: "- Tonicity\n- Why cells burst",
            revision: 1,
            created_at: 1_700_000_000,
            updated_at: 1_700_000_000,
          },
        ],
        total: 1,
        page: 1,
        page_size: 10,
      },
    }),
  );
  await page.route(`**/api/py/projects/${P}/study/unclear-cards`, (route) => {
    created.push(route.request().postDataJSON());
    return route.fulfill({
      status: 201,
      json: { id: spot.root_id, front: "What is tonicity?" },
    });
  });

  await page.goto("/e2e/projects?view=project&tab=reflections");
  // The reflection links to the Study tab's Progress panel.
  await expect(
    page.getByRole("link", { name: "Practice in Progress" }),
  ).toHaveAttribute("href", `/projects/${P}?tab=study#progress`);
  await page.getByRole("tab", { name: "Study" }).click();
  const panel = page.getByRole("region", { name: "From your reflections" });
  const first = panel.getByRole("listitem", { name: "Unclear: Tonicity" });
  await expect(first.getByLabel("Question")).toHaveValue("Tonicity");
  await expect(first.getByRole("button", { name: "Add card" })).toBeDisabled();
  await first.getByLabel("Question").fill("What is tonicity?");
  await first.getByLabel("Answer").fill("Relative solute concentration");
  await first.getByRole("button", { name: "Add card" }).click();
  await expect(panel.getByRole("status")).toContainText(
    "Card added: What is tonicity?",
  );
  // The added item leaves the list; the other still needs its own confirmation.
  await expect(first).toHaveCount(0);
  await expect(
    panel
      .getByRole("listitem", { name: "Unclear: Why cells burst" })
      .getByLabel("Question"),
  ).toHaveValue("Why cells burst");
  expect(created).toEqual([
    {
      reflection_id: R,
      item: "Tonicity",
      deck_id: null,
      front: "What is tonicity?",
      back: "Relative solute concentration",
      weak_spot: true,
    },
  ]);
  // The new card needs practice until it is recalled.
  const weak = page.getByRole("region", { name: "Needs practice" });
  await expect(weak).toContainText("Flagged as unclear");
  expect(errors).toEqual([]);
});
