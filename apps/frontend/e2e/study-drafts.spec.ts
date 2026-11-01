import type { Page } from "@playwright/test";
import { expect, test } from "./support/test";

const P = "11111111-1111-4111-8111-111111111111";
const D = "22222222-2222-4222-8222-222222222222";
const F1 = "33333333-3333-4333-8333-333333333331";
const F2 = "33333333-3333-4333-8333-333333333332";
const deck = {
  id: D,
  project_id: P,
  name: "Cell biology",
  description: "",
  card_count: 0,
  created_at: 1,
  updated_at: 1,
};
const citation = {
  file_id: F1,
  chunk_id: "chunk-1",
  artifact_generation: 1,
  excerpt: "ATP stores and transfers energy.",
  available: true,
  file_name: "lecture-3.pdf",
};

async function mockStudy(page: Page, saved: unknown[]) {
  const cards: Record<string, unknown>[] = [];
  await page.route(`**/api/py/projects/${P}/study/decks/${D}`, (route) =>
    route.fulfill({ json: { ...deck, card_count: cards.length } }),
  );
  await page.route(
    `**/api/py/projects/${P}/study/decks/${D}/cards?**`,
    (route) =>
      route.fulfill({
        json: { items: cards, total: cards.length, page: 1, page_size: 25 },
      }),
  );
  await page.route(
    `**/api/py/projects/${P}/study/decks/${D}/cards`,
    (route) => {
      const body = route.request().postDataJSON();
      saved.push(body);
      const card = {
        id: `card-${saved.length}`,
        deck_id: D,
        front: body.front,
        back: body.back,
        citations: [citation],
        created_at: 1,
        updated_at: 1,
      };
      cards.push(card);
      return route.fulfill({ status: 201, json: card });
    },
  );
  await page.route(`**/api/py/projects/${P}/files?**`, (route) =>
    route.fulfill({
      json: {
        files: [
          { id: F1, filename: "lecture-3.pdf" },
          { id: F2, filename: "reading.docx" },
        ],
        total: 2,
        page: 1,
        page_size: 100,
      },
    }),
  );
  await page.route("**/api/py/chat/models", (route) =>
    route.fulfill({
      json: [
        {
          id: "44444444-4444-4444-8444-444444444444",
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
  await page.route(
    `**/api/py/projects/${P}/study/decks/${D}/card-drafts`,
    (route) =>
      route.fulfill({
        json: {
          drafts: [
            {
              front: "What does **ATP** do?",
              back: "Stores and transfers energy, $\\Delta G < 0$ on hydrolysis.",
              citations: [citation],
            },
            {
              front: "Where is ATP made?",
              back: "Mostly in the mitochondria.",
              citations: [citation],
            },
            {
              front: "<img src=x onerror=alert(1)> Injected?",
              back: "Rendered as text only.",
              citations: [{ ...citation, chunk_id: null, excerpt: null }],
            },
          ],
          files: [
            {
              file_id: F1,
              file_name: "lecture-3.pdf",
              status: "used",
              message: null,
              card_count: 3,
              truncated: true,
            },
            {
              file_id: F2,
              file_name: "reading.docx",
              status: "failed",
              message: "This file is still being processed.",
              card_count: 0,
              truncated: false,
            },
          ],
        },
      }),
  );
}

test("reviews drafted cards, accepting, editing and discarding each before saving", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => {
    errors.push(`dialog: ${dialog.message()}`);
    return dialog.dismiss();
  });
  const saved: Record<string, unknown>[] = [];
  await mockStudy(page, saved);

  await page.goto("/e2e/study?view=drafts");
  await expect(
    page.getByRole("heading", { level: 1, name: "Draft cards" }),
  ).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Draft cards" }).click();
  const drafts = page.getByRole("region", { name: "Drafts" });
  await expect(drafts.getByText("Where is ATP made?")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "File results" }),
  ).toContainText("This file is still being processed.");
  // Untrusted generated HTML stays inert text.
  await expect(drafts.locator("img")).toHaveCount(0);
  await page.screenshot({
    path: "test-results/study-drafts-desktop.png",
    fullPage: true,
  });

  await page.getByRole("button", { name: "Discard Draft 3" }).click();
  await page.getByRole("button", { name: "Edit Draft 2" }).click();
  const second = page.getByRole("listitem", { name: "Draft 2" });
  await second.getByLabel("Back").fill("In the mitochondria.");
  await second.getByRole("button", { name: "Done editing" }).click();
  await page.getByRole("button", { name: "Accept all (2)" }).click();
  await expect(drafts.getByText("Saved to deck")).toHaveCount(2);
  expect(saved.map((card) => card.back)).toEqual([
    "Stores and transfers energy, $\\Delta G < 0$ on hydrolysis.",
    "In the mitochondria.",
  ]);
  expect(saved[0].citations).toEqual([
    {
      file_id: F1,
      chunk_id: "chunk-1",
      artifact_generation: 1,
      excerpt: "ATP stores and transfers energy.",
    },
  ]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/study-drafts-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await page.goto("/e2e/study?view=deck");
  await expect(
    page.getByRole("heading", { level: 1, name: "Cell biology" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Draft from files" }),
  ).toHaveAttribute("href", `/projects/${P}/study/${D}/drafts`);
  expect(errors).toEqual([]);
});
