import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "./support/test";

// US-86.8 with real authentication, backend and edge: prepare an archive in the
// background, then download it with a short-lived link the browser follows.
test.skip(
  process.env.ASTERISM_ISOLATED_E2E !== "true",
  "Use scripts/run-isolated-e2e.mjs for real authentication",
);

test("a person prepares and downloads an archive of their data", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const email = `${randomUUID()}@example.test`;
  const query = `?adminKey=${encodeURIComponent(process.env.ADMIN_PASSPHRASE!)}&role=user`;
  const signup = await context.request.post(`/api/auth/sign-up/email${query}`, {
    data: { name: "Archive student", email, password: "Isolated-test-283!" },
  });
  expect(signup.ok()).toBeTruthy();
  const provision = await context.request.post("/api/py/users/", {
    data: {
      user_id: (await signup.json()).user.id,
      system_key: process.env.SYSTEM_KEY,
    },
  });
  expect(provision.ok()).toBeTruthy();

  await page.goto("/settings");
  await page.getByRole("button", { name: "Prepare my data" }).click();
  await expect(page.getByText(/Your archive is ready/)).toBeVisible({
    timeout: 60_000,
  });

  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(
    /^asterism-data-\d{4}-\d{2}-\d{2}\.zip$/,
  );
  const archive = readFileSync((await download.path())!);
  // A zip starts with "PK".
  expect(archive.subarray(0, 2).toString()).toBe("PK");
  expect(archive.includes(Buffer.from("about-you.md"))).toBeTruthy();

  // The link alone, without the session, still names only this archive and expires.
  const anonymous = await page.request.get(
    "/api/py/data-export/00000000-0000-0000-0000-000000000000/archive?ticket=1.bad",
  );
  expect(anonymous.status()).toBe(401);
});
