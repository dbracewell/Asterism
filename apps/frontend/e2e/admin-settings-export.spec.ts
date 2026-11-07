import { readFile } from "node:fs/promises";
import { expect, test } from "./support/test";

const FILE = {
  format: "asterism.settings-export",
  format_version: 1,
  salt: "c2FsdHNhbHRzYWx0c2FsdA==",
  ciphertext: "token",
};

test("exports application settings to a downloaded file", async ({ page }) => {
  let body: unknown;
  await page.route("**/api/py/**", (route) => {
    if (route.request().url().endsWith("/settings/app/transfer/export")) {
      body = route.request().postDataJSON();
      return route.fulfill({ json: FILE });
    }
    return route.fulfill({
      status: 503,
      json: { detail: "Fixture unavailable" },
    });
  });
  await page.goto("/e2e/planned-settings?setting=group-settings");
  await page
    .getByRole("tablist")
    .last()
    .getByRole("tab", { name: "Export", exact: true })
    .click();
  const submit = page.getByRole("button", { name: "Export settings" });
  await expect(submit).toBeDisabled();
  await page.getByLabel("Passphrase", { exact: true }).fill("correct horse");
  await page.getByLabel("Confirm passphrase").fill("correct horse");
  const download = page.waitForEvent("download");
  await submit.click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(
    /^asterism-settings-\d{4}-\d{2}-\d{2}\.json$/,
  );
  expect(JSON.parse(await readFile(await file.path(), "utf8"))).toEqual(FILE);
  expect(body).toEqual({ passphrase: "correct horse" });
  await expect(page.getByRole("status")).toContainText("Settings exported");
});

test("previews a settings file and imports it after confirmation", async ({
  page,
}) => {
  const calls: string[] = [];
  const summary = {
    exported_at: 1_700_000_000,
    providers: [
      { name: "Local", action: "add", models_added: 2, models_updated: 0 },
    ],
    kept_providers: [],
    changed_settings: ["Active tools"],
  };
  await page.route("**/api/py/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.includes("/settings/app/transfer/")) {
      calls.push(path.split("/").pop() ?? "");
      return route.fulfill({ json: summary });
    }
    return route.fulfill({
      status: 503,
      json: { detail: "Fixture unavailable" },
    });
  });
  await page.goto("/e2e/planned-settings?setting=group-settings");
  await page
    .getByRole("tablist")
    .last()
    .getByRole("tab", { name: "Export", exact: true })
    .click();
  await page.getByLabel("Settings file").setInputFiles({
    name: "settings.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(FILE)),
  });
  await page.getByLabel("File passphrase").fill("correct horse");
  await page.getByRole("button", { name: "Preview import" }).click();
  await expect(page.getByText(/Add Local/)).toBeVisible();
  expect(calls).toEqual(["preview"]);
  await page.getByRole("button", { name: "Import settings" }).click();
  await expect(page.getByRole("status")).toContainText("Settings imported");
  expect(calls).toEqual(["preview", "import"]);
});
