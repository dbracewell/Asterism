import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./support/test";

const P = "11111111-1111-4111-8111-111111111111";
const N = "55555555-5555-4555-8555-555555555551";
const D = "22222222-2222-4222-8222-222222222222";
const Q = "33333333-3333-4333-8333-333333333333";
const F1 = "66666666-6666-4666-8666-666666666661";
const M = "77777777-7777-4777-8777-777777777777";
const citation = {
  file_id: F1,
  chunk_id: "chunk-1",
  artifact_generation: 1,
  excerpt: "ATP stores and transfers energy.",
  available: true,
  file_name: "lecture-3.pdf",
};

async function mockStudy(page: Page, saved: unknown[]) {
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
  await page.route(`**/api/py/projects/${P}/study/summaries`, (route) =>
    route.fulfill({
      json: {
        title: "Standard summary: lecture-3.pdf",
        depth: "standard",
        sections: [
          {
            file_id: F1,
            file_name: "lecture-3.pdf",
            heading: "Cellular energy",
            text: "ATP **stores** energy; $\\Delta G < 0$ on hydrolysis. <img src=x onerror=alert(1)>",
            citations: [citation],
          },
        ],
        body: "## lecture-3.pdf\n\n### Cellular energy\n\nATP stores energy.\n",
        citations: [citation],
        files: [
          {
            file_id: F1,
            file_name: "lecture-3.pdf",
            status: "used",
            message: null,
            section_count: 1,
            truncated: false,
          },
        ],
        model_id: M,
        model_name: "Study model",
      },
    }),
  );
  await page.route(`**/api/py/projects/${P}/study/study-guides`, (route) =>
    route.fulfill({
      json: {
        title: "Study guide for 9 November 2026",
        start_date: "2026-11-02",
        exam_date: "2026-11-09",
        minutes_per_day: 60,
        days: [
          {
            date: "2026-11-02",
            focus: "Cell energy",
            tasks: [
              {
                text: "Review the flashcards",
                minutes: 30,
                link: { kind: "deck", id: D, title: "Cell biology" },
              },
            ],
          },
          {
            date: "2026-11-08",
            focus: "Self-test",
            tasks: [
              {
                text: "Take the practice quiz",
                minutes: 25,
                link: { kind: "quiz", id: Q, title: "Cells quiz" },
              },
            ],
          },
        ],
        body: "Plan",
        model_id: M,
        model_name: "Study model",
      },
    }),
  );
  await page.route(`**/api/py/projects/${P}/study/notes`, (route) => {
    saved.push(route.request().postDataJSON());
    return route.fulfill({ status: 201, json: { id: N } });
  });
  await page.route(`**/api/py/projects/${P}/study/notes/${N}`, (route) =>
    route.fulfill({
      json: {
        id: N,
        project_id: P,
        kind: "summary",
        title: "Cells summary",
        body: "## lecture-3.pdf\n\n### Cellular energy\n\nATP **stores** energy.\n\n- [Cell biology deck](/projects/p/study/d)",
        citations: [
          citation,
          { ...citation, available: false, file_name: null },
        ],
        model_id: M,
        model_name: "Study model",
        created_at: 1_800_000_000,
        updated_at: 1_800_000_000,
      },
    }),
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

test("summarizes files and saves the summary as a note", async ({ page }) => {
  const errors = trackErrors(page);
  const saved: Record<string, unknown>[] = [];
  await mockStudy(page, saved);
  await page.goto("/e2e/study?view=summary");
  await expect(
    page.getByRole("heading", { level: 1, name: "Summarize files" }),
  ).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("Standard").check();
  await page.getByRole("button", { name: "Summarize" }).click();
  const summary = page.getByRole("region", { name: "Summary" });
  await expect(
    summary.getByRole("heading", { name: "Cellular energy" }),
  ).toBeVisible();
  await expect(summary.locator("img")).toHaveCount(0);
  await expect(summary.getByText("lecture-3.pdf").first()).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).include("main").analyze()).violations,
  ).toEqual([]);
  await page.screenshot({
    path: "test-results/study-summary-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Save as note" }).click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0]).toMatchObject({
    kind: "summary",
    title: "Standard summary: lecture-3.pdf",
    model_id: M,
  });
  expect(errors).toEqual([]);
});

test("plans study days linked to decks and quizzes", async ({ page }) => {
  const errors = trackErrors(page);
  const saved: Record<string, unknown>[] = [];
  await mockStudy(page, saved);
  await page.goto("/e2e/study?view=guide");
  await expect(
    page.getByRole("heading", { level: 1, name: "Plan for an exam" }),
  ).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Plan study days" }).click();
  const plan = page.getByRole("region", { name: "Study plan" });
  await expect(
    plan.getByRole("link", { name: "Cell biology" }),
  ).toHaveAttribute("href", `/projects/${P}/study/${D}`);
  await expect(plan.getByRole("link", { name: "Cells quiz" })).toHaveAttribute(
    "href",
    `/projects/${P}/study/quizzes/${Q}`,
  );
  expect(
    (await new AxeBuilder({ page }).include("main").analyze()).violations,
  ).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/study-guide-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Save as note" }).click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0]).toMatchObject({ kind: "study_guide", body: "Plan" });
  expect(errors).toEqual([]);
});

test("shows a saved note with its sources", async ({ page }) => {
  const errors = trackErrors(page);
  await mockStudy(page, []);
  await page.goto("/e2e/study?view=note");
  await expect(
    page.getByRole("heading", { level: 1, name: "Cells summary" }),
  ).toBeVisible({ timeout: 15_000 });
  const note = page.getByRole("article", { name: "Note" });
  await expect(
    note.getByRole("heading", { name: "Cellular energy" }),
  ).toBeVisible();
  await expect(
    note.getByRole("link", { name: "Cell biology deck" }),
  ).toBeVisible();
  await expect(
    page.getByText("Source no longer in this project"),
  ).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).include("main").analyze()).violations,
  ).toEqual([]);
  await page.getByRole("button", { name: "Edit note" }).click();
  await expect(page.getByRole("dialog").getByLabel("Body")).toHaveValue(
    /### Cellular energy/,
  );
  expect(errors).toEqual([]);
});
