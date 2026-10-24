import type { Page } from "@playwright/test";
import { defaultPersonas } from "../../src/test/personas";

/** Synthetic chat harnesses need an owned persona just like their model fixtures. */
export async function mockDefaultPersonas(page: Page) {
  await page.route(/\/api\/py\/users\/personas(?:\?.*)?$/, (route) =>
    route.fulfill({ json: defaultPersonas }),
  );
}
