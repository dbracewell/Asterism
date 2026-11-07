import { expect, test, type BrowserContext } from "./support/test";
import { randomUUID } from "node:crypto";

// Real auth and backend: a brand-new student signs up through an invite link.
test.skip(
  process.env.ASTERISM_ISOLATED_E2E !== "true",
  "Use scripts/run-isolated-e2e.mjs for real authentication",
);

async function register(client: BrowserContext, name: string, admin = false) {
  const query = `?adminKey=${encodeURIComponent(process.env.ADMIN_PASSPHRASE!)}&role=${admin ? "admin" : "user"}`;
  const signup = await client.request.post(`/api/auth/sign-up/email${query}`, {
    data: {
      name,
      email: `${randomUUID()}@example.test`,
      password: "Isolated-test-283!",
    },
  });
  expect(signup.ok()).toBeTruthy();
  const provision = await client.request.post("/api/py/users/", {
    data: {
      user_id: (await signup.json()).user.id,
      system_key: process.env.SYSTEM_KEY,
    },
  });
  expect(provision.ok()).toBeTruthy();
}

test("a new student creates an account with a single-use invite", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const baseURL = "http://localhost:3100";
  const contexts = await Promise.all(
    Array.from({ length: 4 }, () => browser.newContext({ baseURL })),
  );
  const [adminContext, educatorContext, studentContext, strangerContext] =
    contexts;
  try {
    const educatorName = `Educator ${randomUUID().slice(0, 8)}`;
    await register(adminContext, "Invite admin", true);
    await register(educatorContext, educatorName);
    const admin = await adminContext.newPage();
    const educator = await educatorContext.newPage();

    await educator.goto("/classes");
    await educator
      .getByRole("button", { name: "Request educator access" })
      .click();
    await expect(
      educator.getByText(/waiting for an administrator/),
    ).toBeVisible();
    await admin.goto("/settings?t=admin&setting=educators");
    await admin
      .getByRole("button", { name: `Approve ${educatorName}` })
      .click();
    await expect(
      admin.getByRole("button", { name: `Revoke ${educatorName}` }),
    ).toBeVisible();

    await educator.reload();
    await educator.getByLabel("Class name").fill("Chemistry");
    await educator.getByRole("button", { name: "Create class" }).click();
    await expect(
      educator.getByRole("heading", { name: "Chemistry" }),
    ).toBeVisible();

    await educator.getByLabel("Student names, one per line").fill("Priya\nRaj");
    await educator.getByRole("button", { name: "Create invites" }).click();
    const links = educator.getByRole("group", { name: "New invite links" });
    const linkFor = async (label: string) =>
      (await links
        .getByRole("listitem")
        .filter({ hasText: label })
        .getByText(/\/invite\//)
        .textContent())!;
    const priyaLink = await linkFor("Priya");
    const rajLink = await linkFor("Raj");

    // Signed out, the student opens the link and signs up in one step.
    const student = await studentContext.newPage();
    await student.goto(priyaLink);
    await expect(
      student.getByText(
        `You're invited to join Chemistry with ${educatorName}.`,
      ),
    ).toBeVisible();
    await student.getByLabel("Your name").fill("Priya Patel");
    await student.getByLabel("Email").fill(`${randomUUID()}@example.test`);
    await student.getByLabel("Password").fill("Student-pass-283!");
    await student
      .getByRole("button", { name: "Create account and join" })
      .click();
    await expect(student).toHaveURL(/\/classes$/);
    await expect(student.getByText(`Run by ${educatorName}`)).toBeVisible();

    // The same link no longer works for anyone else.
    const stranger = await strangerContext.newPage();
    await stranger.goto(priyaLink);
    await expect(
      stranger.getByText("This invite can't be used."),
    ).toBeVisible();

    // The educator sees who used it and withdraws the other one.
    await educator.reload();
    await expect(educator.getByText(/Priya Patel joined on/)).toBeVisible();
    await expect(
      educator.getByRole("button", { name: "Remove Priya Patel" }),
    ).toBeVisible();
    await educator
      .getByRole("button", { name: "Withdraw invite for Raj" })
      .click();
    await expect(educator.getByText("Withdrawn")).toBeVisible();
    await stranger.goto(rajLink);
    await expect(
      stranger.getByText("This invite can't be used."),
    ).toBeVisible();
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
