import { expect, test as base, type ConsoleMessage } from "@playwright/test";

export { expect, request } from "@playwright/test";
export type {
  BrowserContext,
  Locator,
  Page,
  WebSocketRoute,
} from "@playwright/test";

/** A console report of a Content Security Policy refusal (US-86.5). */
export function isCspViolation(text: string): boolean {
  return /Content Security Policy/i.test(text);
}

/**
 * Every browser case must fail on unhandled application errors and on any
 * Content Security Policy refusal: the suite runs a production build under the
 * real page policy, so a blocked script, style, image, font or WebSocket shows
 * up here.
 */
export const test = base.extend<{
  browserErrors: void;
  /** Set only by cases that provoke a refusal to prove the policy holds. */
  cspViolationsExpected: boolean;
}>({
  cspViolationsExpected: [false, { option: true }],
  browserErrors: [
    async ({ page, cspViolationsExpected }, use) => {
      const errors: string[] = [];
      const violations: string[] = [];
      const record = (error: Error) =>
        errors.push(error.stack ?? error.message);
      const recordConsole = (message: ConsoleMessage) => {
        if (isCspViolation(message.text())) violations.push(message.text());
      };
      page.on("pageerror", record);
      page.on("console", recordConsole);
      await use();
      page.off("pageerror", record);
      page.off("console", recordConsole);
      expect(errors, "Unhandled browser errors").toEqual([]);
      if (!cspViolationsExpected)
        expect(violations, "Content Security Policy violations").toEqual([]);
    },
    { auto: true },
  ],
});
