import { expect, test } from "./support/test";
import { classCast, createClass } from "./support/classes";

// Real auth and backend: a student opts in, and the educator still sees no
// insights until enough students share.
test.skip(
  process.env.ASTERISM_ISOLATED_E2E !== "true",
  "Use scripts/run-isolated-e2e.mjs for real authentication",
);

test("insights wait for consent from enough students", async ({ browser }) => {
  test.setTimeout(120_000);
  const { educator, student, educatorName, close } = await classCast(
    browser,
    "Insights",
  );
  try {
    const code = await createClass(educator, "Physics");
    const insights = educator.getByRole("region", { name: "Class insights" });
    await expect(
      insights.getByText(/at least 5 students share their results\. 0 have/),
    ).toBeVisible();

    await student.goto(`/classes?join=${code}`);
    await student.getByRole("button", { name: "Join class" }).click();
    const share = student.getByRole("switch", {
      name: "Share my practice results in class totals",
    });
    await expect(share).not.toBeChecked();
    await expect(
      student.getByText(
        new RegExp(`${educatorName} sees only totals by course file`),
      ),
    ).toBeVisible();
    await share.click();
    await expect(share).toBeChecked();
    await student.reload();
    await expect(share).toBeChecked();

    await educator.reload();
    await expect(
      insights.getByText(/at least 5 students share their results\. 1 has/),
    ).toBeVisible();
    await expect(insights.getByRole("list")).toHaveCount(0);

    // Withdrawing takes effect at once.
    await share.click();
    await expect(share).not.toBeChecked();
    await educator.reload();
    await expect(insights.getByText(/0 have so far/)).toBeVisible();
  } finally {
    await close();
  }
});
