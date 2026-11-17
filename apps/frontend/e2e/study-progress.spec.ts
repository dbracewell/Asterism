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
  topics: [],
  ...overrides,
});

const topic = (overrides: Record<string, unknown>) => ({
  key: "cells",
  label: "Cells",
  level: "needs_work",
  score: 0.4,
  practiced: 2,
  total: 5,
  deck_count: 1,
  quiz_count: 1,
  trend: [
    { at: 1, score: 0.2 },
    { at: 2, score: 0.4 },
  ],
  ...overrides,
});

test("shows topics, items that need practice and unclear items, and practises a topic", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const practiced: unknown[] = [];
  await page.route(`**/api/py/projects/${P}/study/progress`, (route) =>
    route.fulfill({
      json: {
        topics: [
          topic({}),
          topic({
            key: "energy",
            label: "Energy",
            level: "not_started",
            score: null,
            practiced: 0,
            total: 3,
            trend: [
              { at: 1, score: null },
              { at: 2, score: null },
            ],
          }),
        ],
        weak_spots: {
          items: [
            spot({ topics: ["cells"] }),
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
              topics: ["energy"],
            }),
          ],
          total: 2,
        },
        unclear: {
          items: [
            {
              reflection_id: "77777777-7777-4777-8777-777777777777",
              chat_id: null,
              reflected_at: 1_800_000_000,
              text: "Why do <b>cells</b> burst?",
            },
          ],
          total: 1,
        },
        computed_at: 1,
      },
    }),
  );
  await page.route(`**/api/py/projects/${P}/study/decks?**`, (route) =>
    route.fulfill({ json: { items: [], total: 0, page: 1, page_size: 100 } }),
  );
  await page.route(`**/api/py/projects/${P}/study/practice`, (route) => {
    practiced.push(route.request().postDataJSON());
    return route.fulfill({
      status: 201,
      json: { id: W, questions: [], origin: "practice" },
    });
  });

  await page.goto("/e2e/study?view=progress");
  const panel = page.getByRole("region", { name: "Progress" });
  await expect(
    panel.getByRole("heading", { name: "Progress", exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    panel.getByRole("listitem", { name: "Cells", exact: true }),
  ).toContainText("Needs work");
  const section = panel.getByRole("region", { name: "Needs practice" });
  await expect(section.getByText("2 items")).toBeVisible();
  await expect(section.getByText("Rated Again", { exact: true })).toBeVisible();
  await expect(section.locator("img")).toHaveCount(0);
  await expect(
    section.getByRole("link", { name: "Cell biology quiz" }),
  ).toHaveAttribute("href", `/projects/${P}/study/quizzes/${Q}`);
  const reflections = panel.getByRole("region", {
    name: "From your reflections",
  });
  await expect(reflections.getByLabel("Question")).toHaveValue(
    "Why do <b>cells</b> burst?",
  );
  await expect(reflections.locator("b")).toHaveCount(0);
  expect(
    (await new AxeBuilder({ page }).include("main").analyze()).violations,
  ).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/study-progress-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await panel.getByRole("combobox", { name: "Topic", exact: true }).click();
  await page.getByRole("option", { name: "Energy" }).click();
  await expect(section.getByText("1 in Energy")).toBeVisible();
  await expect(section.getByText("Missed", { exact: true })).toHaveCount(0);
  await panel.getByRole("button", { name: "Practice Energy" }).click();
  await expect.poll(() => practiced.length).toBe(1);
  expect(practiced[0]).toEqual({ topic: "Energy", question_count: 3 });
  await expect(page).toHaveURL(
    new RegExp(`/projects/${P}/study/quizzes/${W}/take|sign-in`),
  );
  expect(errors).toEqual([]);
});
