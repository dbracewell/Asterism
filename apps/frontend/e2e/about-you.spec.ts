import { randomUUID } from "node:crypto";
import { expect, test } from "./support/test";

for (const width of [1280, 320]) {
  test(`About you saves, persists and fits at ${width}px`, async ({
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
    const signup = await context.request.post(
      `/api/auth/sign-up/email?adminKey=${encodeURIComponent(process.env.ADMIN_PASSPHRASE!)}&role=user`,
      {
        data: { name: "About tester", email, password: "About-test-832!" },
      },
    );
    expect(signup.ok()).toBeTruthy();
    const user = (await signup.json()).user;
    const provision = await context.request.post("/api/py/users/", {
      data: { user_id: user.id, system_key: process.env.SYSTEM_KEY },
    });
    expect(provision.ok()).toBeTruthy();
    await page.setViewportSize({ width, height: width === 320 ? 300 : 720 });
    await page.goto("/settings?t=user&setting=your-asterism&keep=one");
    const text = page.getByLabel("What should Asterism know about you?");
    await expect(text).toHaveValue("");
    await text.fill("I'm a second-year nursing student.");
    const save = page.getByRole("button", { name: "Save", exact: true });
    await save.click();
    await expect(save).toBeDisabled();
    await page.reload();
    await expect(
      page.getByLabel("What should Asterism know about you?"),
    ).toHaveValue("I'm a second-year nursing student.");
    expect(new URL(page.url()).searchParams.getAll("keep")).toEqual(["one"]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({ path: info.outputPath(`about-you-${width}.png`) });
    expect(errors).toEqual([]);
  });
}
