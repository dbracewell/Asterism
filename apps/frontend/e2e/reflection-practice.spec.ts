import { mockDefaultPersonas } from "./support/personas";
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
};

test("turns one confirmed unclear item into a card and a weak spot", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockDefaultPersonas(page);
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
  await page.route(`**/api/py/projects/${P}/study/topics`, (route) =>
    route.fulfill({ json: { items: [], computed_at: 1 } }),
  );
  await page.route(`**/api/py/projects/${P}/study/weak-spots?**`, (route) =>
    route.fulfill({
      json: created.length
        ? { items: [spot], total: 1 }
        : { items: [], total: 0 },
    }),
  );
  await page.route("**/api/py/reflections/?**", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: R,
            persona_id: "55555555-5555-4555-8555-555555555555",
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
    return route.fulfill({ status: 201, json: { id: spot.root_id } });
  });

  await page.goto("/e2e/projects?view=overview");
  await page.getByRole("button", { name: "Practice unclear items" }).click();
  const dialog = page.getByRole("dialog", { name: "Practice what's unclear" });
  const first = dialog.getByRole("listitem", { name: "Item 1" });
  await expect(first.getByLabel("Question")).toHaveValue("Tonicity");
  await expect(first.getByRole("button", { name: "Add card" })).toBeDisabled();
  await first.getByLabel("Question").fill("What is tonicity?");
  await first.getByLabel("Answer").fill("Relative solute concentration");
  await first.getByRole("button", { name: "Add card" }).click();
  await expect(first.getByRole("status")).toContainText(
    "Card added: What is tonicity?",
  );
  await expect(
    dialog.getByRole("listitem", { name: "Item 2" }).getByLabel("Question"),
  ).toHaveValue("Why cells burst");
  expect(created).toEqual([
    {
      reflection_id: R,
      deck_id: null,
      front: "What is tonicity?",
      back: "Relative solute concentration",
      weak_spot: true,
    },
  ]);
  await page.keyboard.press("Escape");
  const weak = page.getByRole("region", { name: "Weak spots" });
  await expect(weak).toContainText("Flagged as unclear");
  expect(errors).toEqual([]);
});
