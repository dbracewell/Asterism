import { randomUUID } from "node:crypto";
import type { Browser } from "@playwright/test";
import { expect, type BrowserContext, type Page } from "./test";

/** Real-auth helpers for class, course and policy specs (EPIC-60). */

export const ISOLATED_BASE_URL = "http://localhost:3100";

export async function register(
  client: BrowserContext,
  name: string,
  admin = false,
) {
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

export async function bearer(page: Page) {
  const { token } = await (await page.request.get("/api/auth/token")).json();
  return { Authorization: `Bearer ${token}` };
}

/** Upload a file into the user's library and attach it to a project. */
export async function attachFile(page: Page, projectId: string, name: string) {
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

/** An admin, an approved educator and a student, each signed in. */
export async function classCast(browser: Browser, label: string) {
  const contexts = await Promise.all(
    Array.from({ length: 3 }, () =>
      browser.newContext({ baseURL: ISOLATED_BASE_URL }),
    ),
  );
  const [adminContext, educatorContext, studentContext] = contexts;
  const educatorName = `Educator ${randomUUID().slice(0, 8)}`;
  await register(adminContext, `${label} admin`, true);
  await register(educatorContext, educatorName);
  await register(studentContext, `${label} student`);
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
  await admin.getByRole("button", { name: `Approve ${educatorName}` }).click();
  await expect(
    admin.getByRole("button", { name: `Revoke ${educatorName}` }),
  ).toBeVisible();
  await educator.reload();
  return {
    admin,
    educator,
    student,
    educatorName,
    close: () => Promise.all(contexts.map((context) => context.close())),
  };
}

/** Create a class from the educator's Classes page; returns its join code. */
export async function createClass(educator: Page, name: string) {
  await educator.getByLabel("Class name").fill(name);
  await educator.getByRole("button", { name: "Create class" }).click();
  await expect(educator.getByRole("heading", { name })).toBeVisible();
  return (await educator.getByLabel("Class code").textContent())!;
}

/** Publish a project as the next course version from the class page. */
export async function publishCourse(
  educator: Page,
  project: string,
  version: number,
  note = "",
) {
  if (version === 1) {
    await educator
      .getByRole("combobox", { name: "Project to publish" })
      .click();
    await educator.getByRole("option", { name: project }).click();
  }
  await educator.getByLabel("What's new (optional)").fill(note);
  await educator
    .getByRole("button", { name: `Publish version ${version}` })
    .click();
  await expect(
    educator.getByRole("button", { name: `Publish version ${version + 1}` }),
  ).toBeVisible();
}
