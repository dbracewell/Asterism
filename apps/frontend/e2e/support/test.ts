import { expect, test as base } from "@playwright/test";

export { expect, request } from "@playwright/test";
export type {
  BrowserContext,
  Locator,
  Page,
  WebSocketRoute,
} from "@playwright/test";

/** Every browser case must fail on unhandled application errors. */
export const test = base.extend<{ browserErrors: void }>({
  browserErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      const record = (error: Error) =>
        errors.push(error.stack ?? error.message);
      page.on("pageerror", record);
      await use();
      page.off("pageerror", record);
      expect(errors, "Unhandled browser errors").toEqual([]);
    },
    { auto: true },
  ],
});
