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
