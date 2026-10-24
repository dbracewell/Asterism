import { randomUUID } from "node:crypto";
import { expect, test } from "./support/test";

for (const width of [1280, 320]) {
  test(`persona lifecycle persists and remains reachable at ${width}px`, async ({
    context,
    page,
  }, info) => {
    test.skip(
      process.env.ASTERISM_ISOLATED_E2E !== "true",
      "Requires isolated authentication and storage",
    );
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const email = `${randomUUID()}@example.test`;
    const password = "Persona-test-352!";
    const signup = await context.request.post(
      `/api/auth/sign-up/email?adminKey=${encodeURIComponent(process.env.ADMIN_PASSPHRASE!)}&role=user`,
      {
        data: { name: "Persona tester", email, password },
      },
    );
    expect(signup.ok()).toBeTruthy();
    const user = (await signup.json()).user;
    const provision = await context.request.post("/api/py/users/", {
      data: { user_id: user.id, system_key: process.env.SYSTEM_KEY },
    });
    expect(provision.ok()).toBeTruthy();
    // Sign-up establishes this browser context's authenticated session.
    await page.setViewportSize({ width, height: width === 320 ? 300 : 720 });
    await page.goto("/settings?t=user&setting=personas&keep=one&keep=two");
    await page.getByLabel("New persona name").fill("Teaching");
    await page
      .getByRole("button", { name: "Create persona", exact: true })
      .click();
    await expect(page.getByLabel("Persona name", { exact: true })).toHaveValue(
      "Teaching",
    );
    await page
      .getByLabel("USER.md instructions")
      .fill("Explain concepts with small examples.");
    await page
      .getByRole("button", { name: "Save persona", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Save persona", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Make default", exact: true })
      .click();
    await expect(
      page.getByText("Default persona", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await page
      .getByRole("button", { name: "Edit persona Teaching", exact: true })
      .click();
    await expect(page.getByLabel("USER.md instructions")).toHaveValue(
      "Explain concepts with small examples.",
    );
    await page
      .getByRole("button", { name: "Edit persona Default", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Delete persona", exact: true })
      .click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Delete persona", exact: true }),
    ).toBeFocused();
    await page
      .getByRole("button", { name: "Delete persona", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Delete persona", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Edit persona Default", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByLabel("New persona name")).toBeFocused();
    expect(new URL(page.url()).searchParams.getAll("keep")).toEqual([
      "one",
      "two",
    ]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({ path: info.outputPath(`personas-${width}.png`) });
    const longName = "Teaching preferences and detailed examples "
      .repeat(2)
      .slice(0, 80);
    await page.getByLabel("New persona name").fill(longName);
    await page
      .getByRole("button", { name: "Create persona", exact: true })
      .click();
    await expect(page.getByLabel("Persona name", { exact: true })).toHaveValue(
      longName,
    );
    await page.goto("/");
    const picker = page.getByRole("combobox", {
      name: "Chat persona",
      exact: true,
    });
    await picker.click();
    const choices = page.getByRole("listbox");
    await expect(choices).toBeVisible();
    const bounds = await choices.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
    await page.getByRole("option", { name: longName, exact: true }).click();
    await expect(picker).toContainText(longName);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: info.outputPath(`persona-picker-${width}.png`),
    });
    expect(errors).toEqual([]);
  });
}
