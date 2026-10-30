import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "./support/test";
import type { Skill } from "../src/lib/client";

test.use({ hasTouch: true });
const doc = (name: string, body = "# Instructions\nReview the lesson.") =>
  `---\nname: ${name}\ndescription: Review the lesson.\n---\n${body}\n`;
const makeSkill = (n: number): Skill => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  name: `skill-${String(n).padStart(2, "0")}`,
  description: "Review the lesson.",
  content: doc(`skill-${String(n).padStart(2, "0")}`),
  revision: 1,
  created_at: n,
  updated_at: n,
});

async function mockSkills(page: Page, count = 12) {
  const state = {
    rows: Array.from({ length: count }, (_, i) => makeSkill(i + 1)),
    conflict: false,
    assignmentConflict: false,
    ids: [makeSkill(1).id],
    revision: 4,
    deletes: [] as number[],
    requests: [] as { method: string; url: string; body: unknown }[],
  };
  await page.route(
    (url) => url.pathname.startsWith("/api/py/skills"),
    async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      const body =
        method === "PUT" || method === "POST"
          ? route.request().postDataJSON()
          : undefined;
      state.requests.push({ method, url: url.toString(), body });
      if (url.pathname.endsWith("/eligible"))
        return route.fulfill({
          json: {
            items: [],
            total: 0,
            page: 1,
            page_size: 1,
            policy_enabled: false,
            agent_revision: state.revision,
          },
        });
      if (/\/skills\/?$/.test(url.pathname)) {
        if (method === "POST") {
          const name = body.content.match(/^name: (.+)$/m)?.[1];
          if (!name || name.includes("Bad"))
            return route.fulfill({
              status: 400,
              json: { detail: "Skill name must be lowercase" },
            });
          const skill = { ...makeSkill(99), name, content: body.content };
          state.rows = [skill, ...state.rows];
          return route.fulfill({ status: 201, json: skill });
        }
        const pageNumber = Number(url.searchParams.get("page"));
        const size = Number(url.searchParams.get("page_size"));
        const query = url.searchParams.get("query") ?? "";
        const filtered = state.rows.filter((row) => row.name.includes(query));
        return route.fulfill({
          json: {
            items: filtered.slice((pageNumber - 1) * size, pageNumber * size),
            total: filtered.length,
            page: pageNumber,
            page_size: size,
          },
        });
      }
      const id = url.pathname.split("/").pop();
      const row = state.rows.find((row) => row.id === id);
      if (!row)
        return route.fulfill({
          status: 404,
          json: { detail: "Skill not found" },
        });
      if (method === "PUT") {
        if (state.conflict) {
          state.conflict = false;
          row.revision++;
          row.content = doc(
            row.name,
            "# Server revision\nAnother editor saved this.",
          );
          return route.fulfill({
            status: 409,
            json: { detail: "Skill changed; reload before saving" },
          });
        }
        expect(body.expected_revision).toBe(row.revision);
        Object.assign(row, {
          content: body.content,
          name: body.content.match(/^name: (.+)$/m)[1],
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
  await page.route(
    "**/api/py/settings/user/main-agent/skills",
    async (route) => {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON();
        if (state.assignmentConflict) {
          state.assignmentConflict = false;
          state.revision++;
          return route.fulfill({
            status: 409,
            json: {
              detail: "Main agent changed; reload before assigning skills",
            },
          });
        }
        expect(body.expected_revision).toBe(state.revision);
        expect(Object.keys(body).sort()).toEqual([
          "expected_revision",
          "skill_ids",
        ]);
        state.ids = body.skill_ids;
        state.revision++;
      }
      return route.fulfill({
        json: { skill_ids: state.ids, revision: state.revision },
      });
    },
  );
  await page.route("**/api/py/settings/user/main-agent", (route) =>
    route.fulfill({
      json: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Main",
        description: "",
        config_revision: state.revision,
        tools: [],
      },
    }),
  );
  await page.route("**/api/py/agents/sub-agents?**", (route) =>
    route.fulfill({ json: { items: [], total: 0, page: 1, page_size: 10 } }),
  );
  await page.route("**/api/py/chat/models", (route) =>
    route.fulfill({ json: [] }),
  );
  return state;
}

for (const width of [1280, 390, 320]) {
  test(`skill source, safe preview, conflicts and confirmed deletion at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: width === 320 ? 360 : 700 });
    const state = await mockSkills(page);
    const unwanted: string[] = [];
    await page.route("**/untrusted.test/**", (route) => {
      unwanted.push(route.request().url());
      return route.abort();
    });
    await page.goto("/e2e/skills?t=user&setting=skills&keep=x&keep=y");
    await expect(
      page.getByRole("heading", { name: "Skills", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Next skills", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "View or edit skill-11" }),
    ).toBeVisible();
    await page.getByRole("textbox", { name: "Search skills" }).fill("skill-01");
    await expect(
      page.getByRole("button", { name: "View or edit skill-01" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Next skills", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("textbox", { name: "Search skills" }).fill("");
    await page.getByRole("button", { name: "New skill" }).click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("textbox", { name: "SKILL.md source" })
      .fill(
        doc(
          "lesson-review",
          "# Review\n<script>window.skillExecuted = true</script>\n![beacon](https://untrusted.test/beacon)",
        ),
      );
    await dialog.getByRole("tab", { name: "Preview", exact: true }).click();
    await expect(
      dialog.getByRole("heading", { name: "Review", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.locator(
        '[aria-label="Skill preview"] script, [aria-label="Skill preview"] img',
      ),
    ).toHaveCount(0);
    expect(unwanted).toEqual([]);
    await dialog.getByRole("button", { name: "Save skill" }).click();
    await page
      .getByRole("button", { name: "View or edit lesson-review" })
      .click();
    await dialog.getByRole("tab", { name: "Source", exact: true }).click();
    const draft = doc("lesson-review", "# My unsaved draft");
    await dialog.getByRole("textbox", { name: "SKILL.md source" }).fill(draft);
    state.conflict = true;
    await dialog.getByRole("button", { name: "Save skill" }).click();
    await expect(
      dialog.getByText("Skill changed; reload before saving", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("textbox", { name: "SKILL.md source" }),
    ).toHaveValue(draft);
    await dialog.getByRole("button", { name: "Reload current skill" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Discard changes" })
      .click();
    await expect(
      dialog.getByRole("textbox", { name: "SKILL.md source" }),
    ).toHaveValue(
      doc("lesson-review", "# Server revision\nAnother editor saved this."),
    );
    await dialog
      .getByRole("textbox", { name: "SKILL.md source" })
      .fill(doc("lesson-review", "# Final version"));
    await dialog.getByRole("button", { name: "Save skill" }).click();
    await page
      .getByRole("button", { name: "View or edit lesson-review" })
      .click();
    await dialog
      .getByRole("button", { name: "Delete skill", exact: true })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    expect(state.deletes).toEqual([]);
    await dialog
      .getByRole("button", { name: "Delete skill", exact: true })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete skill", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "View or edit lesson-review" }),
    ).toHaveCount(0);
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => state.deletes).toEqual([3]);
    await expect(page.getByRole("button", { name: "New skill" })).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBeTruthy();
    await page.screenshot({ path: info.outputPath(`skills-${width}.png`) });
  });
}

test("assignments retain off-page selections and URL parameters without saving other main settings", async ({
  page,
}) => {
  const state = await mockSkills(page);
  await page.goto("/e2e/skills?t=user&setting=skills&keep=x&keep=y");
  await page.getByRole("tab", { name: "Agents", exact: true }).click();
  expect(new URL(page.url()).searchParams.getAll("keep")).toEqual(["x", "y"]);
  await page.getByRole("button", { name: "Manage main-agent skills" }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("Skill activation disabled by administrator"),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Next skills", exact: true })
    .click();
  await dialog.getByRole("checkbox", { name: /skill-11/ }).check();
  await dialog.getByRole("button", { name: "Save assignments" }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.ids).toEqual([makeSkill(1).id, makeSkill(11).id]);
  await page.getByRole("button", { name: "Manage main-agent skills" }).click();
  await expect(
    dialog.getByRole("checkbox", { name: /skill-01/ }),
  ).toBeChecked();
  await dialog.getByRole("checkbox", { name: /skill-02/ }).check();
  state.assignmentConflict = true;
  await dialog.getByRole("button", { name: "Save assignments" }).click();
  await expect(
    dialog.getByText("Main agent changed; reload before assigning skills"),
  ).toBeVisible();
  await expect(
    dialog.getByRole("checkbox", { name: /skill-02/ }),
  ).toBeChecked();
  await dialog
    .getByRole("button", { name: "Reload current assignments" })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Discard changes" })
    .click();
  await expect(
    dialog.getByRole("checkbox", { name: /skill-02/ }),
  ).not.toBeChecked();
});

test("deleting the only skill on a later page returns to a valid page", async ({
  page,
}) => {
  await mockSkills(page, 11);
  await page.goto("/e2e/skills?t=user&setting=skills");
  await page.getByRole("button", { name: "Next skills", exact: true }).click();
  await page.getByRole("button", { name: "View or edit skill-11" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete skill", exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete skill", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "View or edit skill-01" }),
  ).toBeVisible();
  await expect(page.getByText("No skills yet", { exact: true })).toHaveCount(0);
});

test("authenticated settings create and assign a private skill with real APIs", async ({
  page,
  context,
}) => {
  test.skip(
    process.env.ASTERISM_ISOLATED_E2E !== "true",
    "Use isolated storage",
  );
  const email = `${randomUUID()}@example.test`;
  const signup = await context.request.post(
    `/api/auth/sign-up/email?adminKey=${encodeURIComponent(process.env.ADMIN_PASSPHRASE!)}`,
    { data: { name: "Skills tester", email, password: "Skills-test-321!" } },
  );
  expect(signup.ok()).toBeTruthy();
  const user = (await signup.json()).user;
  expect(
    (
      await context.request.post("/api/py/users/", {
        data: { user_id: user.id, system_key: process.env.SYSTEM_KEY },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/settings?t=user&setting=skills");
  await page.getByRole("button", { name: "New skill" }).click();
  await page
    .getByRole("textbox", { name: "SKILL.md source" })
    .fill(doc("real-review"));
  await page.getByRole("button", { name: "Save skill" }).click();
  await expect(
    page.getByRole("button", { name: "View or edit real-review" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Agents", exact: true }).click();
  await page.getByRole("button", { name: "Manage main-agent skills" }).click();
  await page.getByRole("checkbox", { name: /real-review/ }).check();
  await page.getByRole("button", { name: "Save assignments" }).click();
  // Reload only after the save lands; reloading earlier can cancel it.
  await expect(page.getByText("Skill assignments saved")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Manage main-agent skills" }).click();
  await expect(
    page.getByRole("checkbox", { name: /real-review/ }),
  ).toBeChecked();
  await expect(
    page.getByText("Skill activation disabled by administrator"),
  ).toBeVisible();
});
