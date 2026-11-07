import { expect, test } from "./support/test";
import {
  bearer,
  classCast,
  createClass,
  publishCourse,
} from "./support/classes";

// Real auth and backend: an educator limits modes in the course project, and
// the student sees the limits, who set them, and the narrowed mode picker.
test.skip(
  process.env.ASTERISM_ISOLATED_E2E !== "true",
  "Use scripts/run-isolated-e2e.mjs for real authentication",
);

test("a class policy narrows learning modes in the course project", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { educator, student, educatorName, close } = await classCast(
    browser,
    "Policy",
  );
  try {
    const created = await educator.request.post("/api/py/projects/", {
      headers: await bearer(educator),
      data: { name: "Chem setup", system_prompt: "Guide, don't tell." },
    });
    expect(created.ok()).toBeTruthy();
    await educator.reload();
    const code = await createClass(educator, "Chemistry");
    await publishCourse(educator, "Chem setup", 1);

    const policy = educator.getByRole("region", {
      name: "Learning mode policy",
    });
    for (const mode of ["Standard", "Review my work", "Spot the error"]) {
      await policy.getByRole("checkbox", { name: mode }).click();
    }
    await policy
      .getByRole("switch", {
        name: "Let students reveal answers and solutions",
      })
      .click();
    await policy.getByRole("button", { name: "Save policy" }).click();
    await expect(policy.getByText(/Policy saved/)).toBeVisible();

    await student.goto(`/classes?join=${code}`);
    await student.getByRole("button", { name: "Join class" }).click();
    const course = student.getByRole("region", { name: "Chemistry course" });
    await course.getByRole("button", { name: "Add course" }).click();
    await course.getByRole("link", { name: "Open course project" }).click();
    await expect(student).toHaveURL(/\/projects\/[\w-]{36}/);
    const projectId = new URL(student.url()).pathname.split("/").pop();

    // A new chat in the course project starts in an allowed mode and says why.
    await student.goto(`/?project_id=${projectId}`);
    await expect(student.getByLabel("Course policy")).toHaveText(
      new RegExp(
        `Chemistry: Tutor, Explain-back, Draft feedback or Research assistant modes only, answers can't be revealed\\. Set by ${educatorName}\\.`,
      ),
    );
    const picker = student.getByRole("combobox", { name: "Learning mode" });
    await expect(picker).toHaveText(/Tutor/);
    await picker.click();
    await expect(
      student.getByRole("option", { name: /Standard/ }),
    ).toHaveAttribute("aria-disabled", "true");
    await student.keyboard.press("Escape");

    // The server holds the same policy, whatever the client does.
    const served = await student.request.get(
      `/api/py/course-policy/projects/${projectId}`,
      { headers: await bearer(student) },
    );
    expect(await served.json()).toMatchObject({
      class_name: "Chemistry",
      educator_name: educatorName,
      answer_reveal: false,
    });
  } finally {
    await close();
  }
});
