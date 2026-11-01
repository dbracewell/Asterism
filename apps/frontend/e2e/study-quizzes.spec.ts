import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./support/test";

const P = "11111111-1111-4111-8111-111111111111";
const Q = "33333333-3333-4333-8333-333333333333";
const T = "44444444-4444-4444-8444-444444444444";
const F1 = "66666666-6666-4666-8666-666666666661";
const M = "77777777-7777-4777-8777-777777777777";
const summary = {
  id: Q,
  project_id: P,
  title: "Cell biology quiz",
  question_count: 3,
  multiple_choice_count: 2,
  short_answer_count: 1,
  attempt_count: 0,
  last_score: null,
  best_score: null,
  model_id: M,
  model_name: "Study model",
  created_at: 1,
  updated_at: 1,
};
const quiz = {
  ...summary,
  questions: [
    {
      id: "q-a",
      position: 0,
      kind: "multiple_choice",
      prompt: "Where is most **ATP** made?",
      options: ["Nucleus", "Mitochondria", "Golgi"],
    },
    {
      id: "q-b",
      position: 1,
      kind: "multiple_choice",
      prompt: "<img src=x onerror=alert(1)> Injected?",
      options: ["Yes", "No"],
    },
    {
      id: "q-c",
      position: 2,
      kind: "short_answer",
      prompt: "What does ATP do?",
      options: [],
    },
  ],
};
const citation = {
  file_id: F1,
  chunk_id: "chunk-1",
  artifact_generation: 1,
  excerpt: "ATP stores and transfers energy.",
  available: true,
  file_name: "lecture-3.pdf",
};
const attempt = {
  id: T,
  quiz_id: Q,
  quiz_title: "Cell biology quiz",
  submitted_at: 1_800_000_000,
  score: 1.5,
  question_count: 3,
  ungraded_count: 0,
  grader_model_id: M,
  grader_model_name: "Study model",
  results: [
    {
      question_id: "q-a",
      position: 0,
      kind: "multiple_choice",
      prompt: "Where is most **ATP** made?",
      options: ["Nucleus", "Mitochondria", "Golgi"],
      correct_option: 1,
      rubric: "",
      explanation: "Oxidative phosphorylation happens in mitochondria.",
      citations: [citation],
      choice: 1,
      text: null,
      verdict: "correct",
      grader: "exact",
      feedback: "",
    },
    {
      question_id: "q-b",
      position: 1,
      kind: "multiple_choice",
      prompt: "<img src=x onerror=alert(1)> Injected?",
      options: ["Yes", "No"],
      correct_option: 1,
      rubric: "",
      explanation: "",
      citations: [{ ...citation, available: false, file_name: null }],
      choice: null,
      text: null,
      verdict: "incorrect",
      grader: "none",
      feedback: "No answer given.",
    },
    {
      question_id: "q-c",
      position: 2,
      kind: "short_answer",
      prompt: "What does ATP do?",
      options: [],
      correct_option: null,
      rubric: "Stores and transfers energy.",
      explanation: "",
      citations: [citation],
      choice: null,
      text: "It gives energy",
      verdict: "partial",
      grader: "model",
      feedback: "Mention that it also stores energy.",
    },
  ],
};

async function mockQuizzes(page: Page, submitted: unknown[]) {
  await page.route(`**/api/py/projects/${P}/files?**`, (route) =>
    route.fulfill({
      json: {
        files: [{ id: F1, filename: "lecture-3.pdf" }],
        total: 1,
        page: 1,
        page_size: 100,
      },
    }),
  );
  await page.route("**/api/py/chat/models", (route) =>
    route.fulfill({
      json: [
        {
          id: M,
          name: "study-model",
          display_name: "Study model",
          provider_id: "55555555-5555-4555-8555-555555555555",
          provider_name: "Local",
          provider_type: "openai",
          available: true,
        },
      ],
    }),
  );
  await page.route(`**/api/py/projects/${P}/study/quizzes`, (route) =>
    route.fulfill({
      json: {
        quiz,
        files: [
          {
            file_id: F1,
            file_name: "lecture-3.pdf",
            status: "used",
            message: null,
            question_count: 3,
            truncated: false,
          },
        ],
      },
    }),
  );
  await page.route(`**/api/py/projects/${P}/study/quizzes/${Q}`, (route) =>
    route.fulfill({ json: quiz }),
  );
  await page.route(
    `**/api/py/projects/${P}/study/quizzes/${Q}/attempts`,
    (route) => {
      submitted.push(route.request().postDataJSON());
      return route.fulfill({ status: 201, json: attempt });
    },
  );
  await page.route(
    `**/api/py/projects/${P}/study/quizzes/${Q}/attempts/${T}`,
    (route) => route.fulfill({ json: attempt }),
  );
}

function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => {
    errors.push(`dialog: ${dialog.message()}`);
    return dialog.dismiss();
  });
  return errors;
}

async function noHorizontalOverflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
}

test("generates a quiz and links to taking it", async ({ page }) => {
  const errors = trackErrors(page);
  await mockQuizzes(page, []);
  await page.goto("/e2e/study?view=quiz-new");
  await expect(
    page.getByRole("heading", { level: 1, name: "New practice quiz" }),
  ).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Generate quiz" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Saved Cell biology quiz with 3 questions.",
  );
  await expect(page.getByRole("link", { name: "Start quiz" })).toHaveAttribute(
    "href",
    `/projects/${P}/study/quizzes/${Q}/take`,
  );
  expect(errors).toEqual([]);
});

test("takes a quiz with the keyboard and submits the answers", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const submitted: Record<string, unknown>[] = [];
  await mockQuizzes(page, submitted);
  await page.goto("/e2e/study?view=quiz-take");
  await expect(
    page.getByRole("heading", { level: 1, name: "Cell biology quiz" }),
  ).toBeVisible({ timeout: 15_000 });
  // Untrusted generated HTML stays inert text.
  await expect(page.locator("main img")).toHaveCount(0);

  const first = page.getByRole("radiogroup", { name: /Where is most/ });
  await first.getByRole("radio", { name: /Nucleus/ }).click();
  // Radix checks on arrow focus only while the key is held, as a real key press is.
  await page.keyboard.press("ArrowDown", { delay: 50 });
  await expect(
    first.getByRole("radio", { name: /Mitochondria/ }),
  ).toBeChecked();
  await page
    .getByRole("textbox", { name: "Your answer to question 3" })
    .fill("It gives energy");
  await expect(page.getByText(/1 of 3 unanswered/)).toBeVisible();
  await expect(page.getByLabel("Grading model")).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).include("main form").analyze()).violations,
  ).toEqual([]);
  await page.screenshot({
    path: "test-results/study-quiz-take-desktop.png",
    fullPage: true,
  });

  await page.getByRole("button", { name: "Submit answers" }).click();
  await expect.poll(() => submitted.length).toBe(1);
  expect(submitted[0]).toEqual({
    answers: [
      { question_id: "q-a", choice: 1 },
      { question_id: "q-c", text: "It gives energy" },
    ],
    model_id: M,
  });
  expect(errors).toEqual([]);
});

test("shows graded results with the answer key and citations", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await mockQuizzes(page, []);
  await page.goto("/e2e/study?view=quiz-results");
  await expect(
    page.getByRole("heading", { level: 1, name: "Results: Cell biology quiz" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("1.5 of 3 points (50%)")).toBeVisible();
  const first = page.getByRole("listitem", { name: "Question 1: Correct" });
  await expect(first.getByText("Correct answer · Your answer")).toBeVisible();
  await expect(first.getByText("lecture-3.pdf")).toBeVisible();
  const second = page.getByRole("listitem", { name: "Question 2: Incorrect" });
  await expect(
    second.getByText("Source no longer in this project"),
  ).toBeVisible();
  await expect(second.locator("img")).toHaveCount(0);
  const third = page.getByRole("listitem", {
    name: "Question 3: Partly correct",
  });
  await expect(
    third.getByText("Mention that it also stores energy."),
  ).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).include("main").analyze()).violations,
  ).toEqual([]);
  await page.screenshot({
    path: "test-results/study-quiz-results-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/study-quiz-results-mobile.png",
    fullPage: true,
  });
  expect(await noHorizontalOverflow(page)).toBe(true);
  expect(errors).toEqual([]);
});
