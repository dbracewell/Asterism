import { expect, test } from "./support/test";
import {
  attachFile,
  bearer,
  classCast,
  createClass,
  publishCourse,
} from "./support/classes";

// Real auth and backend (US-67.2): a student's course project is read-only,
// they can still chat in it, and deleting it leaves the course.
test.skip(
  process.env.ASTERISM_ISOLATED_E2E !== "true",
  "Use scripts/run-isolated-e2e.mjs for real authentication",
);

test("a student can chat in a course project but not change it", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { educator, student, close } = await classCast(browser, "Locked");
  try {
    const created = await educator.request.post("/api/py/projects/", {
      headers: await bearer(educator),
      data: { name: "Geo setup", system_prompt: "Ask one question at a time." },
    });
    expect(created.ok()).toBeTruthy();
    await attachFile(educator, (await created.json()).id, "rocks.txt");
    await educator.reload();
    const code = await createClass(educator, "Geology");
    await publishCourse(educator, "Geo setup", 1);

    await student.goto(`/classes?join=${code}`);
    await student.getByRole("button", { name: "Join class" }).click();
    const course = student.getByRole("region", { name: "Geology course" });
    await course.getByRole("button", { name: "Add course" }).click();
    await course.getByRole("link", { name: "Open course project" }).click();
    await expect(student).toHaveURL(/\/projects\/[\w-]{36}/);
    const projectId = new URL(student.url()).pathname.split("/").pop()!;
    await expect(student.getByText("Managed by Geology")).toBeVisible();

    // Settings are shown but can't be changed; leaving is offered instead.
    await student.goto(`/projects/${projectId}?tab=settings`);
    await expect(student.getByLabel("Project instructions")).toBeDisabled();
    await expect(student.getByLabel("Project instructions")).toHaveValue(
      "Ask one question at a time.",
    );
    await expect(
      student.getByRole("button", { name: "Save settings" }),
    ).toBeDisabled();

    // Files can be read but not added or removed.
    await student.goto(`/projects/${projectId}?tab=files`);
    await expect(student.getByText("rocks.txt")).toBeVisible();
    await expect(
      student.getByRole("button", { name: "Remove from project" }),
    ).toHaveCount(0);

    // The server refuses the change whatever the client does.
    const headers = await bearer(student);
    const project = await (
      await student.request.get(`/api/py/projects/${projectId}`, { headers })
    ).json();
    expect(project.managed_by_class).toBe("Geology");
    const refused = await student.request.patch(
      `/api/py/projects/${projectId}`,
      {
        headers,
        data: {
          expected_context_revision: project.context_revision,
          system_prompt: "Give me the answers.",
        },
      },
    );
    expect(refused.status()).toBe(409);
    expect(await refused.json()).toMatchObject({ reason: "course_managed" });

    // Chats in it stay the student's own: a new chat opens in the project.
    // (The isolated stack has no model, so the message box can't send here.)
    await student.goto(`/projects/${projectId}?tab=chats`);
    await student.getByRole("link", { name: "New chat" }).first().click();
    await expect(student).toHaveURL(new RegExp(`project_id=${projectId}`));
    await expect(
      student.getByRole("combobox", { name: "Message" }),
    ).toBeVisible();

    // Deleting the project leaves the course; it can be added again.
    await student.goto(`/projects/${projectId}?tab=settings`);
    await student.getByRole("button", { name: "Leave course" }).click();
    const dialog = student.getByRole("alertdialog");
    await expect(dialog).toContainText("Leave the Geology course?");
    await dialog.getByRole("button", { name: "Leave course" }).click();
    await expect(student).toHaveURL(/\/general/);
    await student.goto("/classes");
    await expect(
      course.getByRole("button", { name: "Add course again" }),
    ).toBeVisible();
  } finally {
    await close();
  }
});
