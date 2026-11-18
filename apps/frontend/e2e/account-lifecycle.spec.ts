import { randomUUID } from "node:crypto";
import type { APIRequestContext, Browser } from "@playwright/test";
import { ISOLATED_BASE_URL, bearer } from "./support/classes";
import { expect, test, type BrowserContext } from "./support/test";

// US-86.2 with real authentication and backend: deletion request, one-time
// reset link, suspension, reactivation and deletion.
test.skip(
  process.env.ASTERISM_ISOLATED_E2E !== "true",
  "Use scripts/run-isolated-e2e.mjs for real authentication",
);

const OLD_PASSWORD = "Isolated-test-283!";
const NEW_PASSWORD = "Orbital-reset-417!";

async function register(
  client: BrowserContext,
  name: string,
  admin = false,
): Promise<{ id: string; email: string }> {
  const email = `${randomUUID()}@example.test`;
  const query = `?adminKey=${encodeURIComponent(process.env.ADMIN_PASSPHRASE!)}&role=${admin ? "admin" : "user"}`;
  const signup = await client.request.post(`/api/auth/sign-up/email${query}`, {
    data: { name, email, password: OLD_PASSWORD },
  });
  expect(signup.ok()).toBeTruthy();
  const id = (await signup.json()).user.id as string;
  const provision = await client.request.post("/api/py/users/", {
    data: { user_id: id, system_key: process.env.SYSTEM_KEY },
  });
  expect(provision.ok()).toBeTruthy();
  return { id, email };
}

async function signIn(
  request: APIRequestContext,
  email: string,
  password: string,
) {
  return request.post("/api/auth/sign-in/email", {
    data: { email, password },
  });
}

async function fresh(browser: Browser) {
  return browser.newContext({ baseURL: ISOLATED_BASE_URL });
}

test("an administrator resets, suspends, reactivates and deletes an account", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const label = randomUUID().slice(0, 8);
  const studentName = `Lifecycle student ${label}`;
  const adminContext = await fresh(browser);
  const studentContext = await fresh(browser);
  await register(adminContext, `Lifecycle admin ${label}`, true);
  const student = await register(studentContext, studentName);
  const admin = await adminContext.newPage();
  const studentPage = await studentContext.newPage();

  // The student asks for deletion; nothing else changes.
  await studentPage.goto("/settings");
  await studentPage
    .getByRole("button", { name: "Ask to delete my account" })
    .click();
  await studentPage.getByRole("button", { name: "Send request" }).click();
  await expect(
    studentPage.getByText(/You asked for your account to be deleted/),
  ).toBeVisible();

  await admin.goto("/settings?t=admin&setting=user-permissions");
  await admin.getByLabel("Search users").fill(label);
  const row = admin.getByRole("listitem").filter({ hasText: studentName });
  await expect(row.getByText(/Asked for deletion/)).toBeVisible();
  const actions = row.getByRole("button", {
    name: `Account actions for ${studentName}`,
  });

  // Raw lifecycle routes are closed over HTTP; the admin UI is the way in.
  for (const path of ["ban-user", "unban-user", "remove-user"]) {
    const raw = await admin.request.post(`/api/auth/admin/${path}`, {
      data: { userId: student.id },
    });
    expect(raw.status()).toBe(404);
  }

  // A one-time reset link: works once, then refuses, and ends old sessions.
  await actions.click();
  await admin
    .getByRole("menuitem", { name: "Create password reset link" })
    .click();
  const link = await admin
    .getByRole("textbox", { name: "Password reset link" })
    .inputValue();
  await admin.getByRole("button", { name: "Done" }).click();
  const resetPath = new URL(link);
  expect(resetPath.pathname).toBe("/reset-password");

  for (const attempt of ["first", "reuse"] as const) {
    const context = await fresh(browser);
    const page = await context.newPage();
    await page.goto(`${resetPath.pathname}${resetPath.search}`);
    await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("Confirm new password").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Set password" }).click();
    if (attempt === "first") {
      await expect(page.getByText("Your password is set.")).toBeVisible();
    } else {
      await expect(page.locator("#reset-error")).toContainText(
        "may have been used already or expired",
      );
    }
    await context.close();
  }
  const oldSession = await studentContext.request.get("/api/auth/get-session");
  expect(await oldSession.json()).toBeNull();
  expect(
    (await signIn(studentContext.request, student.email, OLD_PASSWORD)).ok(),
  ).toBe(false);
  expect(
    (await signIn(studentContext.request, student.email, NEW_PASSWORD)).ok(),
  ).toBe(true);
  // A token issued before suspension, to check the backend refuses it.
  await studentPage.goto("/settings");
  const token = await bearer(studentPage);

  // Suspend: sign-in is blocked and the still-valid token is refused.
  await actions.click();
  await admin.getByRole("menuitem", { name: "Suspend" }).click();
  await admin.getByRole("button", { name: "Suspend" }).click();
  await expect(row.getByText("Suspended", { exact: true })).toBeVisible();
  const suspendedSignIn = await signIn(
    (await fresh(browser)).request,
    student.email,
    NEW_PASSWORD,
  );
  expect(suspendedSignIn.ok()).toBe(false);
  expect(await suspendedSignIn.text()).toContain("suspended");
  const refused = await studentContext.request.get(
    "/api/py/users/me/deletion-request",
    { headers: token },
  );
  expect(refused.status()).toBe(401);

  // Reactivate: sign-in works again with the same data.
  await actions.click();
  await admin.getByRole("menuitem", { name: "Reactivate" }).click();
  await expect(row.getByText("Suspended", { exact: true })).toBeHidden();
  const back = await fresh(browser);
  expect((await signIn(back.request, student.email, NEW_PASSWORD)).ok()).toBe(
    true,
  );
  const backPage = await back.newPage();
  await backPage.goto("/settings");
  await expect(
    backPage.getByText(/You asked for your account to be deleted/),
  ).toBeVisible();

  // Delete: confirmation names what goes; no sign-in account remains.
  await actions.click();
  await admin.getByRole("menuitem", { name: "Delete account" }).click();
  await expect(admin.getByRole("alertdialog")).toContainText("can't be undone");
  await admin.getByRole("button", { name: "Delete account" }).click();
  await expect(row).toHaveCount(0);
  const gone = await fresh(browser);
  expect((await signIn(gone.request, student.email, NEW_PASSWORD)).ok()).toBe(
    false,
  );
  // The email is free again: the old auth account is really gone.
  const again = await gone.request.post(
    `/api/auth/sign-up/email?adminKey=${encodeURIComponent(process.env.ADMIN_PASSPHRASE!)}&role=user`,
    {
      data: {
        name: "New person",
        email: student.email,
        password: OLD_PASSWORD,
      },
    },
  );
  expect(again.ok()).toBeTruthy();
  expect((await again.json()).user.id).not.toBe(student.id);

  await Promise.all([
    adminContext.close(),
    studentContext.close(),
    back.close(),
    gone.close(),
  ]);
});
