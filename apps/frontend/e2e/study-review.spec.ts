import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./support/test";

const P = "11111111-1111-4111-8111-111111111111";
const D = "22222222-2222-4222-8222-222222222222";

function card(id: string, front: string, back: string, now: number) {
  return {
    id,
    deck_id: D,
    front,
    back,
    citations: [
      {
        file_id: "33333333-3333-4333-8333-333333333331",
        chunk_id: "chunk-1",
        artifact_generation: 1,
        excerpt: "Excerpt",
        available: true,
        file_name: "lecture-3.pdf",
      },
    ],
    state: "learning",
    due_at: now - 30,
    reps: 0,
    lapses: 0,
    created_at: 1,
    updated_at: 1,
    previews: {
      again: now + 60,
      hard: now + 330,
      good: now + 600,
      easy: now + 8 * 86400,
    },
  };
}

test("reviews due cards with the keyboard alone and passes an accessibility scan", async ({
  page,
}) => {
  const now = Math.floor(Date.now() / 1000);
  const ratings: { card: string; rating: string; expected_reps: number }[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(`**/api/py/projects/${P}/study/decks/${D}`, (route) =>
    route.fulfill({
      json: {
        id: D,
        project_id: P,
        name: "Cell biology",
        description: "",
        card_count: 2,
        due_count: 2,
        created_at: 1,
        updated_at: 1,
      },
    }),
  );
  await page.route(
    `**/api/py/projects/${P}/study/decks/${D}/review?**`,
    (route) =>
      route.fulfill({
        json: {
          items: [
            card(
              "c1",
              "What does **ATP** do?",
              "Stores energy, $\\Delta G < 0$.",
              now,
            ),
            card("c2", "Where is ATP made?", "In the mitochondria.", now),
          ],
          due_count: 2,
          now,
        },
      }),
  );
  await page.route(
    new RegExp(`/api/py/projects/${P}/study/decks/${D}/cards/(c\\d)/reviews$`),
    (route) => {
      const id = route
        .request()
        .url()
        .match(/cards\/(c\d)\//)![1];
      const body = route.request().postDataJSON();
      ratings.push({ card: id, ...body });
      const again = body.rating === "again";
      return route.fulfill({
        json: {
          ...card(
            id,
            id === "c1" ? "What does **ATP** do?" : "Where is ATP made?",
            "Answer",
            now,
          ),
          reps: body.expected_reps + 1,
          state: again ? "learning" : "review",
          due_at: again ? now + 60 : now + 2 * 86400,
        },
      });
    },
  );

  await page.goto("/e2e/study?view=review");
  const show = page.getByRole("button", { name: "Show answer" });
  await expect(show).toBeFocused({ timeout: 15_000 });
  await expect(page.getByText("Stores energy")).toHaveCount(0);
  await page.keyboard.press("Space");
  await expect(page.getByText("Stores energy")).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /^Good 10m · key 3 , next review in 10 minutes$/,
    }),
  ).toBeFocused();
  expect(
    (
      await new AxeBuilder({ page })
        .include('[aria-label="Review session"]')
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: "test-results/study-review-desktop.png",
    fullPage: true,
  });

  // Again brings the card back in this session; the other card comes first.
  await page.keyboard.press("1");
  await expect(page.getByText("Where is ATP made?")).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.press("3");
  await expect(page.getByText("What does")).toBeVisible();
  await page.keyboard.press("Space");
  await page.keyboard.press("4");
  const summary = page.getByRole("region", { name: "Review summary" });
  await expect(summary).toBeFocused();
  await expect(summary).toContainText("You reviewed 3 cards.");
  expect(ratings).toEqual([
    { card: "c1", rating: "again", expected_reps: 0 },
    { card: "c2", rating: "good", expected_reps: 0 },
    { card: "c1", rating: "easy", expected_reps: 1 },
  ]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole("button", { name: "Show answer" }).click();
  await page.screenshot({
    path: "test-results/study-review-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
