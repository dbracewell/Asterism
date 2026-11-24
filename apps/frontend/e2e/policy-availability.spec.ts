import type { Page } from "@playwright/test";
import { expect, test } from "./support/test";

// EPIC-96: an admin policy change shows up without a reload. Since EPIC-97,
// a setting the admin has turned off is hidden rather than disabled. The settings
// harness renders the real settings page and mutation cache; switching tabs is
// the same soft navigation as in the app, so nothing re-renders the layout.
type Switches = { memory: boolean; canvas: boolean };

const off = (reason: string) => ({ available: false, reason });

async function mockApi(page: Page, switches: Switches) {
  await page.route("**/api/py/**", (route) =>
    route.fulfill({ status: 404, json: { detail: "Unmocked request" } }),
  );
  await page.route("**/api/py/availability", (route) =>
    route.fulfill({
      json: {
        memory: switches.memory
          ? { available: true, reason: "" }
          : off("Your administrator has turned memory off"),
        canvas: switches.canvas
          ? { available: true, reason: "" }
          : off("Your administrator has turned canvas off"),
        image_generation: off("Image generation is turned off"),
        skills: off("Your administrator has turned skills off"),
        chatgpt_plans: off("Off"),
        delegation: off("Off"),
      },
    }),
  );
  await page.route("**/api/py/settings/app/memory", async (route) => {
    if (route.request().method() === "PUT") {
      switches.memory = route.request().postDataJSON().enabled;
    }
    return route.fulfill({
      json: { enabled: switches.memory, group_ids: null },
    });
  });
  await page.route("**/api/py/settings/app/canvas", async (route) => {
    if (route.request().method() === "PUT") {
      switches.canvas = route.request().postDataJSON().enabled;
    }
    return route.fulfill({ json: { enabled: switches.canvas } });
  });
  await page.route("**/api/py/users/me/memories/availability*", (route) =>
    route.fulfill({
      json: switches.memory
        ? { available: true, reason: "" }
        : {
            available: false,
            off_by: "policy",
            reason: "Your administrator has turned memory off",
          },
    }),
  );
  await page.route("**/api/py/groups*", (route) => route.fulfill({ json: [] }));
}

test("turning memory on in Admin Settings shows Use memory without a reload", async ({
  page,
}) => {
  const switches = { memory: false, canvas: false };
  await mockApi(page, switches);
  await page.goto("/e2e/skills?admin=true&t=user&setting=your-asterism");
  const useMemory = page.getByRole("checkbox", { name: "Use memory" });
  // Off, with nothing saved: no Memory section at all (EPIC-97).
  await expect(page.getByRole("tab", { name: "Your Asterism" })).toBeVisible();
  await expect(useMemory).toHaveCount(0);

  await page.getByRole("tab", { name: "Admin Settings" }).click();
  await page.getByRole("tab", { name: "Memory", exact: true }).click();
  await page.getByRole("switch", { name: "Enable memory" }).check();
  await page.getByRole("button", { name: "Save availability" }).click();
  await expect(page.getByText("Availability saved.")).toBeVisible();

  // A reload would clear this marker.
  await page.evaluate(() => {
    (window as unknown as { kept?: boolean }).kept = true;
  });
  await page.getByRole("tab", { name: "User Settings" }).click();
  await page.getByRole("tab", { name: "Your Asterism" }).click();
  await expect(useMemory).toBeEnabled();
  await expect(useMemory).toBeChecked();
  expect(
    await page.evaluate(() => (window as unknown as { kept?: boolean }).kept),
  ).toBe(true);
});

test("turning canvas on in Admin Settings shows the Canvas setting without a reload", async ({
  page,
}) => {
  const switches = { memory: false, canvas: false };
  await mockApi(page, switches);
  await page.goto("/e2e/skills?admin=true&t=user&setting=general");
  const canvas = page.getByRole("checkbox", { name: "Canvas" });
  await expect(page.getByText("Show thinking")).toBeVisible();
  await expect(canvas).toHaveCount(0);

  await page.getByRole("tab", { name: "Admin Settings" }).click();
  await page.getByRole("tab", { name: "Canvas", exact: true }).click();
  await page.getByRole("switch", { name: "Enable canvas" }).check();
  await page.getByRole("button", { name: "Save canvas policy" }).click();
  await expect(page.getByText("Canvas policy saved.")).toBeVisible();

  await page.getByRole("tab", { name: "User Settings" }).click();
  await page.getByRole("tab", { name: "General", exact: true }).click();
  await expect(canvas).toBeEnabled();
});

test("another person's open tab picks up the change when it regains focus", async ({
  page,
}) => {
  const switches = { memory: false, canvas: false };
  await mockApi(page, switches);
  await page.clock.install();
  await page.goto("/e2e/skills?t=user&setting=your-asterism");
  const useMemory = page.getByRole("checkbox", { name: "Use memory" });
  await expect(page.getByRole("tab", { name: "Your Asterism" })).toBeVisible();
  await expect(useMemory).toHaveCount(0);

  // The admin turns memory on elsewhere; this tab's answer goes stale after 30s.
  switches.memory = true;
  await page.clock.fastForward(31_000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(useMemory).toBeEnabled();
});
