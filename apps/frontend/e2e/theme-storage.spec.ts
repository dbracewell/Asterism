import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { chmod, readFile } from "node:fs/promises";
import path from "node:path";

test("administrator saves persist and a real write failure retains edits for retry", async ({
  page,
  context,
  browser,
}) => {
  test.skip(
    process.env.ASTERISM_ISOLATED_E2E !== "true",
    "Use the isolated storage runner",
  );
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  const signup = await context.request.post(
    `/api/auth/sign-up/email?adminKey=${encodeURIComponent(process.env.ADMIN_PASSPHRASE!)}`,
    {
      data: {
        name: "Theme administrator",
        email: `${randomUUID()}@example.test`,
        password: "Isolated-theme-312!",
      },
    },
  );
  expect(signup.ok()).toBeTruthy();
  const user = (await signup.json()).user;
  expect(user.role).toBe("admin");
  const provision = await context.request.post("/api/py/users/", {
    data: { user_id: user.id, system_key: process.env.SYSTEM_KEY },
  });
  expect(provision.ok()).toBeTruthy();
  await page.goto("/e2e/themes");
  await page.getByRole("button", { name: "New theme", exact: true }).click();
  const name = `Persistent ${randomUUID()}`;
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Theme saved.");
  const entries: { name: string; filename: string }[] = await (
    await context.request.get("/api/theme/list")
  ).json();
  const saved = entries.find((entry) => entry.name === name)!;
  expect(saved).toBeTruthy();
  const directory = path.join(process.env.STORAGE_ROOT!, "themes");
  const target = path.join(directory, `${saved.filename}.json`);
  expect(JSON.parse(await readFile(target, "utf8")).name).toBe(name);
  await chmod(directory, 0o500);
  const revised = `${name} retried`;
  try {
    await page.getByLabel("Name", { exact: true }).fill(revised);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator("#form-theme").getByRole("alert")).toContainText(
      "Your edits are still here",
    );
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(revised);
    await expect(page.getByText("Theme saved.", { exact: true })).toHaveCount(
      0,
    );
    expect(JSON.parse(await readFile(target, "utf8")).name).toBe(name);
  } finally {
    await chmod(directory, 0o700);
  }
  await page.getByRole("button", { name: "Retry save" }).click();
  await expect(page.getByRole("status")).toHaveText("Theme saved.");
  expect(JSON.parse(await readFile(target, "utf8")).name).toBe(revised);
  await page.reload();
  await page.getByRole("button", { name: revised, exact: true }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(revised);
  // A fresh anonymous browser observes the committed catalog and can select it.
  const viewer = await browser.newContext();
  try {
    const response = await viewer.request.get(
      `http://localhost:3100/api/theme?name=${saved.filename}`,
    );
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect((await response.json()).name).toBe(revised);
    await viewer.addCookies([
      {
        name: "asterism-custom-theme-name",
        value: saved.filename,
        url: "http://localhost:3100",
      },
    ]);
    const signIn = await viewer.newPage();
    await signIn.goto("http://localhost:3100/sign-in");
    await expect(signIn.locator("html")).toHaveCSS("--background", "#ffffff");
  } finally {
    await viewer.close();
  }
  expect(failures).toEqual([]);
});
