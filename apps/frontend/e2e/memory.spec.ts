import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { expect, test } from "./support/test";

// US-93.3: your memories in Your Asterism, against the isolated stack. Memory is
// off by default, so the page says why; managing memories works either way.
for (const width of [1280, 320]) {
  test(`your memories can be added, edited and deleted, accessibly, at ${width}px`, async ({
    context,
    page,
  }, info) => {
    test.skip(
      process.env.ASTERISM_ISOLATED_E2E !== "true",
      "Requires isolated authentication and storage",
    );
    test.setTimeout(90_000);
    const email = `${randomUUID()}@example.test`;
    const signup = await context.request.post(
      `/api/auth/sign-up/email?adminKey=${encodeURIComponent(process.env.ADMIN_PASSPHRASE!)}&role=user`,
      { data: { name: "Memory tester", email, password: "Memory-test-832!" } },
    );
    expect(signup.ok()).toBeTruthy();
    const user = (await signup.json()).user;
    const provision = await context.request.post("/api/py/users/", {
      data: { user_id: user.id, system_key: process.env.SYSTEM_KEY },
    });
    expect(provision.ok()).toBeTruthy();
    await page.setViewportSize({ width, height: width === 320 ? 600 : 800 });
    await page.goto("/settings?t=user&setting=your-asterism");

    const memory = page.getByRole("region", { name: "Memory" });
    await expect(
      memory.getByRole("checkbox", { name: "Use memory" }),
    ).toBeDisabled();
    await expect(memory.getByRole("alert")).toContainText(
      "Your administrator has turned memory off. Your saved memories are kept",
    );
    await expect(memory.getByText("No memories yet")).toBeVisible();

    await memory.getByRole("button", { name: "Add a memory" }).click();
    const add = page.getByRole("dialog", { name: "Add a memory" });
    await add.getByLabel("Memory").fill("Learns best from worked examples");
    // Scan once the dialog has finished animating in, not mid-fade.
    await add.evaluate((node) =>
      Promise.all(
        node.getAnimations({ subtree: true }).map((item) => item.finished),
      ),
    );
    expect(
      (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
        .violations,
    ).toEqual([]);
    await add.getByRole("button", { name: "Add memory" }).click();
    await expect(add).toBeHidden();
    const learning = memory.getByRole("region", { name: "How you learn" });
    await expect(learning).toContainText("Learns best from worked examples");

    await memory
      .getByRole("button", {
        name: "Edit memory: Learns best from worked examples",
      })
      .click();
    const edit = page.getByRole("dialog", { name: "Edit memory" });
    await edit.getByLabel("Memory").fill("Learns best from diagrams");
    await edit.getByRole("button", { name: "Save memory" }).click();
    await expect(edit).toBeHidden();
    await expect(learning).toContainText("Learns best from diagrams");

    await page.reload();
    await expect(
      page.getByRole("region", { name: "How you learn" }),
    ).toContainText("Learns best from diagrams");
    expect(
      (
        await new AxeBuilder({ page })
          .include("[data-settings-section]")
          .analyze()
      ).violations,
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({ path: info.outputPath(`memory-${width}.png`) });

    await page.getByRole("button", { name: "Delete all" }).click();
    const confirm = page.getByRole("alertdialog", {
      name: "Delete all 1 memory about you?",
    });
    await confirm.getByRole("button", { name: "Delete all" }).click();
    await expect(page.getByText("No memories yet")).toBeVisible();
  });
}
