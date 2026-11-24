import type { Page } from "@playwright/test";

/** The features `GET /availability` reports (EPIC-96). */
export type Feature =
  | "memory"
  | "canvas"
  | "image_generation"
  | "skills"
  | "chatgpt_plans"
  | "delegation";

const FEATURES: Feature[] = [
  "memory",
  "canvas",
  "image_generation",
  "skills",
  "chatgpt_plans",
  "delegation",
];

/** The availability body with the given features on and the rest off. */
export function availabilityBody(on: Iterable<Feature>) {
  const enabled = new Set(on);
  return Object.fromEntries(
    FEATURES.map((feature) => [
      feature,
      enabled.has(feature)
        ? { available: true, reason: "" }
        : { available: false, reason: "Turned off by your administrator" },
    ]),
  );
}

/** Mock `GET /availability`; register after any catch-all `**\/api/py/**` route. */
export async function mockAvailability(page: Page, on: Iterable<Feature>) {
  const body = availabilityBody(on);
  await page.route("**/api/py/availability", (route) =>
    route.fulfill({ json: body }),
  );
}
