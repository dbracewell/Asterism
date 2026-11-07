import { expect, test, type BrowserContext } from "./support/test";
import { randomUUID } from "node:crypto";

// Real auth, routing, sidebar and backend, with three separate people.
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

test("an admin approves an educator, who runs a class a student joins", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const baseURL = "http://localhost:3100";
  const contexts = await Promise.all([
    browser.newContext({ baseURL }),
    browser.newContext({ baseURL }),
    browser.newContext({ baseURL }),
  ]);
  const [adminContext, educatorContext, studentContext] = contexts;
  try {
    const educatorName = `Educator ${randomUUID().slice(0, 8)}`;
    await register(adminContext, "Class admin", true);
    await register(educatorContext, educatorName);
    await register(studentContext, "Student Sam");
    const admin = await adminContext.newPage();
    const educator = await educatorContext.newPage();
    const student = await studentContext.newPage();

    // The educator finds Classes in the real sidebar and asks for access.
    await educator.goto("/");
    await educator.getByRole("link", { name: "Classes" }).first().click();
    await expect(educator).toHaveURL(/\/classes$/);
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
    await educator.getByLabel("Class name").fill("Biology 101");
    await educator.getByRole("button", { name: "Create class" }).click();
    await expect(educator).toHaveURL(/\/classes\/[\w-]{36}$/);
    await expect(
      educator.getByRole("heading", { name: "Biology 101" }),
    ).toBeVisible();
    const classUrl = educator.url();
    const code = (await educator.getByLabel("Class code").textContent())!;

    // The student joins through a link, and sees who runs the class.
    await student.goto(`/classes?join=${code}`);
    await student.getByRole("button", { name: "Join class" }).click();
    await expect(student.getByText("You joined Biology 101.")).toBeVisible();
    await expect(student.getByText(`Run by ${educatorName}`)).toBeVisible();

    // A student cannot open the educator's view.
    await student.goto(classUrl);
    await expect(
      student.getByText("This class isn't available."),
    ).toBeVisible();
    await expect(student.getByText(code)).toHaveCount(0);

    await educator.reload();
    await educator.getByRole("button", { name: "Remove Student Sam" }).click();
    await expect(educator.getByText("Student Sam (removed)")).toBeVisible();
    await student.goto("/classes");
    await expect(student.getByText("No classes yet")).toBeVisible();
    await student.getByLabel("Class code").fill(code);
    await student.getByRole("button", { name: "Join class" }).click();
    await expect(student.getByText(/class code isn't valid/)).toBeVisible();

    await educator
      .getByRole("button", { name: "Allow Student Sam back" })
      .click();
    await expect(educator.getByText("Nobody has joined yet.")).toBeVisible();
    await student.getByRole("button", { name: "Join class" }).click();
    await expect(student.getByText(`Run by ${educatorName}`)).toBeVisible();
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
