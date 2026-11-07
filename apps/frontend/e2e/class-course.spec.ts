import { expect, test } from "./support/test";
import {
  attachFile,
  bearer,
  classCast,
  createClass,
  publishCourse,
} from "./support/classes";

// Real auth and backend: an educator publishes a project as a course, and a
// student adds it and later takes an update.
test.skip(
  process.env.ASTERISM_ISOLATED_E2E !== "true",
  "Use scripts/run-isolated-e2e.mjs for real authentication",
);

test("a student adds an educator's course and takes an update", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { educator, student, close } = await classCast(browser, "Course");
  try {
    // The educator's own project, with instructions and a file.
    const created = await educator.request.post("/api/py/projects/", {
      headers: await bearer(educator),
      data: { name: "Bio setup", system_prompt: "Ask one question at a time." },
    });
    expect(created.ok()).toBeTruthy();
    const projectId = (await created.json()).id;
    await attachFile(educator, projectId, "week1.txt");

    await educator.reload();
    const code = await createClass(educator, "Ecology");
    await publishCourse(educator, "Bio setup", 1, "Week one");

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
    await publishCourse(educator, "Bio setup", 2, "Week two");

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
    await close();
  }
});
