import {
  ISOLATED_BASE_URL,
  bearer,
  classCast,
  createClass,
  register,
} from "./support/classes";
import { expect, test, type Page } from "./support/test";

// US-66.2: "what is this?" help beside the main controls on study tools,
// reflections, classes, team packs and the settings file.
test.skip(
  process.env.ASTERISM_ISOLATED_E2E !== "true",
  "Signs in against the isolated backend",
);

/** Taps a help button and checks its popover fits a 320px screen. */
async function tapHelp(page: Page, title: string) {
  await page.getByRole("button", { name: `Help: ${title}`, exact: true }).tap();
  const popover = page.getByRole("dialog", {
    name: `Help: ${title}`,
    exact: true,
  });
  await expect(popover).toBeVisible();
  const box = await popover.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
}

test("a learner taps help on classes, packs, study and reflections", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: ISOLATED_BASE_URL,
    hasTouch: true,
    viewport: { width: 320, height: 640 },
  });
  try {
    await register(context, "Inline help learner");
    const page = await context.newPage();
    await page.goto("/classes");
    for (const title of ["Class code", "Class", "Educator"]) {
      await tapHelp(page, title);
    }

    await page.goto("/team-packs");
    await tapHelp(page, "Team pack");

    const created = await page.request.post("/api/py/projects/", {
      headers: await bearer(page),
      data: { name: "Inline help" },
    });
    expect(created.ok()).toBeTruthy();
    const { id } = await created.json();
    await page.goto(`/projects/${id}?tab=study`);
    for (const title of [
      "Flashcards and decks",
      "Practice quizzes and attempts",
      "Study notes",
    ]) {
      await tapHelp(page, title);
    }
    await page.goto(`/projects/${id}?tab=reflections`);
    await tapHelp(page, "Reflection");
  } finally {
    await context.close();
  }
});

test("an educator opens class help from the keyboard; admins see settings file help", async ({
  browser,
}) => {
  const cast = await classCast(browser, "Inline help");
  try {
    const { educator, admin } = cast;
    await createClass(educator, "Help class");
    for (const title of [
      "Class code",
      "Invite links",
      "Class",
      "Course",
      "Learning mode policy",
      "Class insights",
    ]) {
      const trigger = educator.getByRole("button", {
        name: `Help: ${title}`,
        exact: true,
      });
      await trigger.focus();
      await educator.keyboard.press("Enter");
      const popover = educator.getByRole("dialog", {
        name: `Help: ${title}`,
        exact: true,
      });
      await expect(popover).toBeVisible();
      await educator.keyboard.press("Escape");
      await expect(popover).toBeHidden();
      await expect(trigger).toBeFocused();
    }

    await admin.goto("/settings?t=admin&setting=export");
    await expect(
      admin.getByRole("button", { name: "Help: Settings file" }),
    ).toHaveCount(2);
    // Admin-only help stays hidden from everyone else, even in the help center.
    await educator.goto("/help");
    await expect(educator.locator('[id="admin.settings-file"]')).toHaveCount(0);
    await admin.goto("/help");
    await expect(admin.locator('[id="admin.settings-file"]')).toHaveCount(1);
  } finally {
    await cast.close();
  }
});
