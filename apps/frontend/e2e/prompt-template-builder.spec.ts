import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./support/test";

const rtf = {
  id: "rtf",
  revision: 1,
  name: "RTF",
  description: "Role, Task, Format: say who, what, and how.",
  document: {
    name: "RTF",
    description: "Role, Task, Format: say who, what, and how.",
    fields: [
      {
        kind: "short_text",
        key: "role",
        label: "Role",
        help: "Who should the assistant act as?",
        required: true,
        default: "an experienced teacher",
        example: "a senior data analyst",
      },
      {
        kind: "long_text",
        key: "task",
        label: "Task",
        help: "What do you want done?",
        required: true,
      },
      {
        kind: "select",
        key: "format",
        label: "Format",
        required: false,
        options: ["a short bulleted list", "a table"],
        default: "a short bulleted list",
      },
    ],
    body: "Act as {{role}}.\n\nTask: {{task}}{{#format}}\n\nRespond in this format: {{format}}.{{/format}}",
    checklist: [
      "Say who the assistant should act as.",
      "State the task with a clear action verb.",
      "Describe the shape of the answer.",
    ],
  },
};

async function mock(page: Page) {
  await page.route("**/api/py/skills/eligible*", (route) =>
    route.fulfill({
      json: {
        items: [],
        total: 0,
        page: 1,
        page_size: 100,
        policy_enabled: false,
        agent_revision: 1,
      },
    }),
  );
  await page.route("**/api/py/prompt-templates/frameworks", (route) =>
    route.fulfill({ json: { version: 1, items: [rtf] } }),
  );
  await page.route("**/api/py/test-skill-send", (route) =>
    route.fulfill({ json: { ok: true } }),
  );
  await page.route("**/api/py/prompt-templates/?*", (route) =>
    route.fulfill({ json: { items: [], total: 0, page: 1, page_size: 100 } }),
  );
}

for (const [width, height] of [
  [1280, 800],
  [320, 568],
]) {
  test(`builds a framework prompt with linked preview and inserts it at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await mock(page);
    await page.goto("/e2e/skill-chat");
    const input = page.getByLabel("Message", { exact: true });
    await input.fill("Context first. ");
    await page.getByRole("button", { name: "More options" }).click();
    await page.getByRole("menuitem", { name: "Prompt templates" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /^RTF/ }).click();
    await expect(dialog.getByRole("heading", { name: "RTF" })).toBeVisible();

    const preview = dialog.getByTestId("template-preview");
    await expect(preview).toContainText("Act as an experienced teacher.");
    await expect(preview.locator('[data-field="task"]')).toHaveText("[Task]");

    // Required-field validation blocks insertion.
    await dialog.getByRole("button", { name: "Use prompt" }).click();
    await expect(dialog.getByText("Task is required.")).toBeVisible();
    const task = dialog.getByLabel(/^Task/);
    await expect(task).toBeFocused();

    // Focusing a field highlights its preview segment.
    await task.fill("Explain photosynthesis.");
    await expect(preview.locator('[data-field="task"]')).toHaveAttribute(
      "data-active",
    );
    await expect(preview.locator('[data-field="task"]')).toHaveText(
      "Explain photosynthesis.",
    );
    // Hovering a preview segment highlights its field.
    await preview.locator('[data-field="role"]').hover();
    await expect(
      dialog.locator('[data-slot="field"][data-field="role"]'),
    ).toHaveAttribute("data-active");

    // Nothing in the builder overflows the narrow viewport.
    const overflow = await dialog.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    expect(
      (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
        .violations,
    ).toEqual([]);

    await dialog.getByRole("button", { name: "Use prompt" }).click();
    await expect(dialog).toBeHidden();
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(
      "Context first. Act as an experienced teacher.\n\nTask: Explain photosynthesis.\n\nRespond in this format: a short bulleted list.",
    );
    // The inserted prompt is ordinary, editable composer text.
    await input.press("End");
    await input.pressSequentially(" Thanks!");
    await expect(input).toHaveValue(/a short bulleted list\. Thanks!$/);
  });
}

test("slash discovery opens a framework and the send records its provenance at 320px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await mock(page);
  await page.goto("/e2e/skill-chat");
  const input = page.getByLabel("Message", { exact: true });
  await input.fill("/rt");
  await page.getByRole("option", { name: /\/rtf/ }).click();
  await expect(input).toHaveValue("");
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/^Task/).fill("Summarize the chapter.");
  await dialog.getByRole("button", { name: "Use prompt" }).click();
  await expect(page.getByText("Built with RTF")).toBeVisible();
  await page.getByLabel("Send message").click();
  const payload = page.getByLabel("Last accepted payload");
  await expect(payload).toContainText(
    '"template":{"source":"framework","id":"rtf","revision":1,"level":"guided"}',
  );
  await expect(page.getByText("Built with RTF")).toBeHidden();
});

for (const [width, height] of [
  [1280, 800],
  [320, 568],
]) {
  test(`scaffolding levels change the form and are recorded at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await mock(page);
    await page.goto("/e2e/skill-chat");
    const input = page.getByLabel("Message", { exact: true });
    await page.getByRole("button", { name: "More options" }).click();
    await page.getByRole("menuitem", { name: "Prompt templates" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /^RTF/ }).click();
    const levels = dialog.getByRole("tablist", { name: "Scaffolding level" });
    const noOverflow = async () =>
      expect(
        await dialog.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
    const axe = async () =>
      expect(
        (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
          .violations,
      ).toEqual([]);

    // Guided: every field, with examples and defaults.
    await expect(levels.getByRole("tab", { name: "Guided" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(
      dialog.getByText("Example: a senior data analyst"),
    ).toBeVisible();
    await expect(dialog.getByLabel(/^Role/)).toHaveValue(
      "an experienced teacher",
    );
    await expect(
      dialog.getByRole("combobox", { name: "Format" }),
    ).toBeVisible();
    await noOverflow();
    await axe();

    // Freeform: only the checklist and a blank prompt.
    await levels.getByRole("tab", { name: "Freeform" }).click();
    await expect(dialog.getByLabel(/^Role/)).toHaveCount(0);
    const checklist = dialog.getByTestId("template-checklist");
    await expect(checklist.getByRole("checkbox")).toHaveCount(3);
    await checklist.getByLabel("Describe the shape of the answer.").check();
    await noOverflow();
    await axe();

    // Standard: required fields start empty; optional fields sit under More.
    // The level tabs are keyboard operable.
    await levels.getByRole("tab", { name: "Freeform" }).press("ArrowLeft");
    await expect(levels.getByRole("tab", { name: "Standard" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(dialog.getByLabel(/^Role/)).toHaveValue(
      "an experienced teacher",
    );
    await expect(
      dialog.getByText("Example: a senior data analyst"),
    ).toBeHidden();
    await expect(dialog.getByRole("combobox", { name: "Format" })).toBeHidden();
    const more = dialog.getByRole("button", { name: "More (1 optional)" });
    await more.click();
    await expect(
      dialog.getByRole("combobox", { name: "Format" }),
    ).toBeVisible();
    await noOverflow();
    await axe();

    await dialog.getByLabel(/^Task/).fill("Compare two plans.");
    await dialog.getByRole("button", { name: "Use prompt" }).click();
    await expect(dialog).toBeHidden();
    await expect(input).toHaveValue(
      "Act as an experienced teacher.\n\nTask: Compare two plans.\n\nRespond in this format: a short bulleted list.",
    );
    await expect(page.getByText("· Standard")).toBeVisible();
    await page.getByLabel("Send message").click();
    await expect(page.getByLabel("Last accepted payload")).toContainText(
      '"level":"standard"',
    );
  });
}
