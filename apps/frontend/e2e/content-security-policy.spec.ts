import { expect, isCspViolation, test } from "./support/test";

// US-86.5: pages carry a nonce-based CSP that the app works under. The shared
// fixture fails any case with a CSP report, so the whole suite checks that the
// app's own scripts, styles, images and WebSockets are allowed.

function nonceOf(policy: string | undefined) {
  return /'nonce-([^']+)'/.exec(policy ?? "")?.[1];
}

test("pages run only the nonce'd scripts Next.js renders", async ({ page }) => {
  const response = await page.goto("/sign-in");
  const headers = response!.headers();
  const policy = headers["content-security-policy"];
  expect(policy).toContain("'strict-dynamic'");
  expect(policy).toContain("frame-ancestors 'none'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("same-origin");
  expect(headers["x-frame-options"]).toBe("DENY");

  // Every script tag in the server HTML carries this response's nonce.
  const nonce = nonceOf(policy);
  const html = await response!.text();
  const scripts = html.match(/<script\b[^>]*>/g) ?? [];
  expect(scripts.length).toBeGreaterThan(0);
  for (const tag of scripts) expect(tag).toContain(`nonce="${nonce}"`);

  // The page hydrated: the form is interactive under the policy.
  const email = page.getByLabel("Email");
  await email.fill("someone@example.test");
  await expect(email).toHaveValue("someone@example.test");

  // A fresh nonce per page view.
  const again = await page.reload();
  expect(nonceOf(again!.headers()["content-security-policy"])).not.toBe(nonce);
});

test.describe("enforcement", () => {
  test.use({ cspViolationsExpected: true });

  test("other origins are refused", async ({ page }) => {
    await page.goto("/sign-in");
    const refused = await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          document.addEventListener("securitypolicyviolation", (event) =>
            resolve(event.effectiveDirective),
          );
          const image = document.createElement("img");
          image.src = "https://untrusted.test/pixel.png";
          document.body.append(image);
        }),
    );
    expect(refused).toBe("img-src");
  });
});

test.describe("canvas preview", () => {
  // The preview's own fetch is refused on purpose; nothing else may be.
  test.use({ cspViolationsExpected: true });

  test("a canvas HTML page runs its own script but reaches no network", async ({
    page,
  }) => {
    const reports: string[] = [];
    page.on("console", (message) => {
      if (isCspViolation(message.text())) reports.push(message.text());
    });
    await page.goto("/e2e/canvas-preview");
    const frame = page.frameLocator('iframe[title="Preview of Script page"]');
    await expect(frame.getByRole("heading")).toHaveText("Script ran");
    const preview = page
      .frames()
      .find((candidate) => candidate.url().endsWith("/canvas-preview.html"))!;
    await expect.poll(() => preview.title()).toBe("network blocked");
    // The frame has an opaque origin: no cookies or storage of the app.
    expect(await preview.evaluate(() => self.origin)).toBe("null");
    expect(reports.length).toBeGreaterThan(0);
    for (const report of reports) {
      expect(report).toMatch(/connect/i);
      expect(report).toContain("/api/py/settings/user");
    }
  });
});

test("the preview frame document can be framed only by the app", async ({
  request,
}) => {
  const response = await request.get("/canvas-preview.html");
  const policy = response.headers()["content-security-policy"];
  expect(policy).toContain("default-src 'none'");
  expect(policy).toContain("frame-ancestors 'self'");
  expect(policy).not.toMatch(/connect-src/);
});
