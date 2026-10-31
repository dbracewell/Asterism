import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./support/test";

const rtfDocument = {
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
    },
    {
      kind: "select",
      key: "format",
      label: "Format",
      help: "",
      required: true,
      options: ["a short bulleted list", "a table"],
      default: "a short bulleted list",
    },
  ],
  body: "Act as {{role}}.\n\nRespond as {{format}}.",
};
const rtf = {
  id: "rtf",
  revision: 1,
  name: rtfDocument.name,
  description: rtfDocument.description,
  document: rtfDocument,
};

type Row = {
  id: string;
  name: string;
  description: string;
  revision: number;
  created_at: number;
  updated_at: number;
  document: typeof rtfDocument;
};

async function mock(page: Page) {
  const state = {
    rows: [] as Row[],
    conflict: false,
    creates: [] as unknown[],
    deletes: [] as number[],
  };
  await page.route("**/api/py/prompt-templates/frameworks", (route) =>
    route.fulfill({ json: { version: 1, items: [rtf] } }),
  );
  await page.route(
    (url) =>
      url.pathname.startsWith("/api/py/prompt-templates") &&
      !url.pathname.includes("/frameworks"),
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();
      if (/\/prompt-templates\/?$/.test(url.pathname)) {
        if (method === "POST") {
          const { document } = request.postDataJSON();
          state.creates.push(document);
          const row: Row = {
            id: `00000000-0000-4000-8000-00000000000${state.rows.length + 1}`,
            name: document.name,
            description: document.description,
            revision: 1,
            created_at: 1,
            updated_at: 1,
            document,
          };
          state.rows = [row, ...state.rows];
          return route.fulfill({ status: 201, json: row });
        }
        return route.fulfill({
          json: {
            items: state.rows.map((row) => ({ ...row, document: undefined })),
            total: state.rows.length,
            page: 1,
            page_size: 10,
          },
        });
      }
      const id = url.pathname.split("/").pop();
      const row = state.rows.find((item) => item.id === id);
      if (!row)
        return route.fulfill({
          status: 404,
          json: { detail: "Prompt template not found" },
        });
      if (method === "PUT") {
        const body = request.postDataJSON();
        if (state.conflict) {
          state.conflict = false;
          row.revision += 1;
          row.document = { ...row.document, name: "Saved elsewhere" };
          row.name = "Saved elsewhere";
          return route.fulfill({
            status: 409,
            json: { detail: "Prompt template changed; reload before saving" },
          });
        }
        expect(body.expected_revision).toBe(row.revision);
        Object.assign(row, {
          document: body.document,
          name: body.document.name,
          description: body.document.description,
          revision: row.revision + 1,
        });
      }
      if (method === "DELETE") {
        const revision = Number(url.searchParams.get("expected_revision"));
        expect(revision).toBe(row.revision);
        state.deletes.push(revision);
        state.rows = state.rows.filter((item) => item.id !== id);
        return route.fulfill({ status: 204 });
      }
      return route.fulfill({ json: row });
    },
  );
  return state;
}

const axe = (page: Page, selector: string) =>
  new AxeBuilder({ page }).include(selector).analyze();

for (const [width, height] of [
  [1280, 800],
  [320, 568],
]) {
  test(`duplicates, edits, resolves a conflict and deletes a template at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const state = await mock(page);
    // The skills harness is a generic signed-in settings page.
    await page.goto("/e2e/skills?t=user&setting=templates");
    await expect(
      page.getByRole("heading", { name: "Templates", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("No templates yet")).toBeVisible();
    expect((await axe(page, "[data-settings-pane]")).violations).toEqual([]);

    // Duplicate a framework with the keyboard.
    const duplicate = page.getByRole("button", {
      name: "Duplicate RTF",
      exact: true,
    });
    await duplicate.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue(
      "RTF (copy)",
    );
    expect(
      (await axe(page, '[role="dialog"]')).violations.map((v) => [
        v.id,
        v.nodes.map((n) => n.target),
      ]),
    ).toEqual([]);

    // Add an audience field and place it in the body.
    await dialog.getByRole("button", { name: "Add field" }).click();
    const label = dialog.getByLabel("Label").nth(2);
    await expect(label).toBeFocused();
    await label.fill("Audience");
    await dialog.getByLabel("Key").nth(2).fill("audience");
    const body = dialog.getByLabel("Prompt body");
    await body.fill("Act as {{role}} for ");
    await dialog.getByRole("button", { name: "Insert {{audience}}" }).click();
    await expect(body).toBeFocused();
    await page.keyboard.type(". Respond as {{format}}.");
    await expect(body).toHaveValue(
      "Act as {{role}} for {{audience}}. Respond as {{format}}.",
    );

    // Errors are reported before saving.
    await dialog.getByLabel("Key").nth(2).fill("Audience");
    await dialog.getByRole("button", { name: "Save template" }).click();
    const issues = dialog.getByRole("alert");
    await expect(issues).toBeFocused();
    await expect(issues).toContainText(
      "Key must start with a lowercase letter",
    );
    expect((await axe(page, '[role="dialog"]')).violations).toEqual([]);
    await dialog.getByLabel("Key").nth(2).fill("audience");
    await expect(issues).toBeHidden();

    // The preview is the builder the composer uses, without "Use prompt".
    await dialog.getByRole("tab", { name: "Preview" }).click();
    const preview = dialog.getByTestId("template-preview");
    await expect(preview).toHaveText(
      "Act as an experienced teacher for [Audience]. Respond as a short bulleted list.",
    );
    await dialog.getByLabel("Audience").fill("new teachers");
    await expect(preview).toContainText("for new teachers.");
    await expect(
      dialog.getByRole("button", { name: "Use prompt" }),
    ).toHaveCount(0);
    expect((await axe(page, '[role="dialog"]')).violations).toEqual([]);
    const overflow = await dialog.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await dialog.getByRole("button", { name: "Save template" }).click();
    await expect(dialog).toHaveCount(0);
    expect(state.creates).toHaveLength(1);
    // The duplicate is independent of the framework.
    await expect(duplicate).toBeFocused();
    const edit = page.getByRole("button", { name: "Edit RTF (copy)" });
    await expect(edit).toBeVisible();

    // A conflicting save keeps the draft; reloading adopts the server revision.
    await edit.click();
    await dialog.getByLabel("Name", { exact: true }).fill("My RTF");
    state.conflict = true;
    await dialog.getByRole("button", { name: "Save template" }).click();
    await expect(
      dialog.getByText("Prompt template changed; reload before saving"),
    ).toBeVisible();
    await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue(
      "My RTF",
    );
    await dialog
      .getByRole("button", { name: "Reload current template" })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Discard changes" })
      .click();
    await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue(
      "Saved elsewhere",
    );
    await dialog.getByLabel("Name", { exact: true }).fill("My RTF");
    await dialog.getByRole("button", { name: "Save template" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Edit My RTF" }),
    ).toBeFocused();

    // Deletion is confirmed and revision-checked.
    await page.getByRole("button", { name: "Edit My RTF" }).click();
    await dialog.getByRole("button", { name: "Delete template" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete template" })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => state.deletes).toEqual([3]);
    await expect(page.getByText("No templates yet")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "New template" }),
    ).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBeTruthy();
  });
}

test("reorders and removes fields with the keyboard", async ({ page }) => {
  await mock(page);
  await page.goto("/e2e/skills?t=user&setting=templates");
  await page.getByRole("button", { name: "New template" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Add field" }).click();
  await expect(dialog.getByLabel("Label").nth(1)).toBeFocused();
  // Enter in a single-line input does not save the template.
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Move Field 2 up" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    dialog.getByRole("button", { name: "Move Field 2 down" }),
  ).toBeFocused();
  await expect(
    dialog.getByRole("group", { name: /^Field 1:/ }),
  ).toHaveAccessibleName("Field 1: Field 2");
  await dialog.getByRole("button", { name: "Remove Field 2" }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("button", { name: "Add field" })).toBeFocused();
  await expect(dialog.getByRole("group", { name: /^Field \d/ })).toHaveCount(1);
  expect((await axe(page, '[role="dialog"]')).violations).toEqual([]);
});
