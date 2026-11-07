import { expect, test, type BrowserContext, type Page } from "./support/test";
import { randomUUID } from "node:crypto";

// Real auth and backend: an educator publishes a project as a course, and a
// student adds it and later takes an update.
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

async function bearer(page: Page) {
  const { token } = await (await page.request.get("/api/auth/token")).json();
  return { Authorization: `Bearer ${token}` };
}

/** Upload a file into the educator's library and attach it to the project. */
async function attachFile(page: Page, projectId: string, name: string) {
  const headers = await bearer(page);
  const upload = await page.request.post("/api/py/files/", {
    headers,
    multipart: {
      files: { name, mimeType: "text/plain", buffer: Buffer.from(name) },
    },
  });
  expect(upload.ok()).toBeTruthy();
  const [file] = (await upload.json()).files;
  const project = await (
    await page.request.get(`/api/py/projects/${projectId}`, { headers })
  ).json();
  const attach = await page.request.post(
    `/api/py/projects/${projectId}/files`,
    {
      headers,
      data: {
        expected_context_revision: project.context_revision,
        file_ids: [file.id],
      },
    },
  );
  expect(attach.ok()).toBeTruthy();
}

test("a student adds an educator's course and takes an update", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const baseURL = "http://localhost:3100";
  const contexts = await Promise.all(
    Array.from({ length: 3 }, () => browser.newContext({ baseURL })),
  );
  const [adminContext, educatorContext, studentContext] = contexts;
  try {
    const educatorName = `Educator ${randomUUID().slice(0, 8)}`;
    await register(adminContext, "Course admin", true);
    await register(educatorContext, educatorName);
    await register(studentContext, "Student Sky");
    const admin = await adminContext.newPage();
    const educator = await educatorContext.newPage();
    const student = await studentContext.newPage();

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

    // The educator's own project, with instructions and a file.
    const created = await educator.request.post("/api/py/projects/", {
      headers: await bearer(educator),
      data: { name: "Bio setup", system_prompt: "Ask one question at a time." },
    });
    expect(created.ok()).toBeTruthy();
    const projectId = (await created.json()).id;
    await attachFile(educator, projectId, "week1.txt");

    await educator.reload();
    await educator.getByLabel("Class name").fill("Ecology");
    await educator.getByRole("button", { name: "Create class" }).click();
    await expect(
      educator.getByRole("heading", { name: "Ecology" }),
    ).toBeVisible();
    const code = (await educator.getByLabel("Class code").textContent())!;

    await educator
      .getByRole("combobox", { name: "Project to publish" })
      .click();
    await educator.getByRole("option", { name: "Bio setup" }).click();
    await educator.getByLabel("What's new (optional)").fill("Week one");
    await educator.getByRole("button", { name: "Publish version 1" }).click();
    await expect(
      educator.getByRole("button", { name: "Publish version 2" }),
    ).toBeVisible();

    await student.goto(`/classes?join=${code}`);
    await student.getByRole("button", { name: "Join class" }).click();
    const course = student.getByRole("region", { name: "Ecology course" });
    await expect(
      course.getByText("Course available (version 1)"),
    ).toBeVisible();
    await expect(course.getByText("week1.txt")).toBeVisible();
    await expect(course.getByText(/Week one/)).toBeVisible();
    await course.getByRole("button", { name: "Add course" }).click();
    await expect(
      course.getByText("You have the latest course (version 1)."),
    ).toBeVisible();

    // The educator publishes an update; the student sees what changed.
    await attachFile(educator, projectId, "week2.txt");
    await educator.getByLabel("What's new (optional)").fill("Week two");
    await educator.getByRole("button", { name: "Publish version 2" }).click();
    await expect(
      educator.getByRole("button", { name: "Publish version 3" }),
    ).toBeVisible();

    await student.reload();
    await expect(
      course.getByText("Version 2 is available. You have version 1."),
    ).toBeVisible();
    await expect(
      course
        .getByRole("list", { name: "What changed" })
        .getByText("Added file week2.txt"),
    ).toBeVisible();
    await course.getByRole("button", { name: "Update to version 2" }).click();
    await expect(
      course.getByText("You have the latest course (version 2)."),
    ).toBeVisible();

    // The copy is the student's own project, with both files.
    await course.getByRole("link", { name: "Open course project" }).click();
    await expect(student).toHaveURL(/\/projects\/[\w-]{36}/);
    const headers = await bearer(student);
    const projectPath = new URL(student.url()).pathname;
    const files = await (
      await student.request.get(`/api/py${projectPath}/files`, { headers })
    ).json();
    expect(JSON.stringify(files)).toMatch(
      /week1\.txt[\s\S]*week2\.txt|week2\.txt[\s\S]*week1\.txt/,
    );
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
