import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./support/test";

const P = "11111111-1111-4111-8111-111111111111";
const Q = "33333333-3333-4333-8333-333333333333";
const D = "22222222-2222-4222-8222-222222222222";
const W = "88888888-8888-4888-8888-888888888888";

const spot = (overrides: Record<string, unknown>) => ({
  root_kind: "question",
  root_id: "99999999-9999-4999-8999-999999999991",
  source_kind: "question",
  source_id: "99999999-9999-4999-8999-999999999991",
  kind: "multiple_choice",
  prompt: "Where is most **ATP** made?",
  outcome: "incorrect",
  missed_at: 1_800_000_000,
  container_id: Q,
  container_title: "Cell biology quiz",
  citations: [],
  ...overrides,
});

test("lists weak spots and builds a practice quiz from them", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const practiced: unknown[] = [];
  await page.route(`**/api/py/projects/${P}/study/weak-spots?**`, (route) =>
    route.fulfill({
      json: {
        items: [
          spot({}),
          spot({
            root_kind: "card",
            root_id: "99999999-9999-4999-8999-999999999992",
            source_kind: "card",
            source_id: "99999999-9999-4999-8999-999999999992",
            kind: "card",
            prompt: "<img src=x onerror=alert(1)> What is ATP?",
            outcome: "again",
            container_id: D,
            container_title:
              "A deck with a rather long name that should truncate",
          }),
        ],
        total: 2,
      },
    }),
  );
  await page.route(
    `**/api/py/projects/${P}/study/weak-spots/practice`,
    (route) => {
      practiced.push(route.request().postDataJSON());
      return route.fulfill({
        status: 201,
        json: { id: W, questions: [], origin: "weak_spots" },
      });
    },
  );

  await page.goto("/e2e/study?view=weak-spots");
  const section = page.getByRole("region", { name: "Weak spots" });
  await expect(
    section.getByRole("heading", { name: "Weak spots" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(section.getByText("2 items to practice")).toBeVisible();
  await expect(section.getByText("Rated Again", { exact: true })).toBeVisible();
  await expect(section.locator("img")).toHaveCount(0);
  await expect(
    section.getByRole("link", { name: "Cell biology quiz" }),
  ).toHaveAttribute("href", `/projects/${P}/study/quizzes/${Q}`);
  expect(
    (await new AxeBuilder({ page }).include("main").analyze()).violations,
  ).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/study-weak-spots-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await section.getByRole("button", { name: "Practice weak spots" }).click();
  await expect.poll(() => practiced.length).toBe(1);
  expect(practiced[0]).toEqual({ question_count: 2 });
  await expect(page).toHaveURL(
    new RegExp(`/projects/${P}/study/quizzes/${W}/take|sign-in`),
  );
  expect(errors).toEqual([]);
});
