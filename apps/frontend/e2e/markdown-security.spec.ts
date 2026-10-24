import { knowledgeArtifact } from "./support/knowledge-artifact";
import { expect, test } from "./support/test";
import { adversarialMarkdown } from "../src/components/markdown-viewer/test-content";

const FILE = "11111111-1111-4111-8111-111111111111";
test("untrusted replies and file text cannot install HTML or load resources; math, code and citations survive", async ({
  page,
  context,
}) => {
  const resourceRequests: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Catch and fulfill attempted requests, including regressions, without contacting
  // untrusted hosts or authenticated same-origin resource endpoints.
  await page.route(/\/untrusted-markdown\//, (route) => {
    resourceRequests.push(route.request().url());
    return route.fulfill({ status: 200, body: "" });
  });
  await page.route("**/api/auth/token", (route) =>
    route.fulfill({ json: { token: "fixture-only" } }),
  );
  const source = {
    id: FILE,
    filename: "fixture.md",
    original_name: "reference.md",
    size: 100,
    mime_type: "text/markdown",
    kind: "text",
    projects: [],
    created_at: 1,
    updated_at: 1,
  };
  await page.route(/\/api\/py\/files\//, (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/knowledge"))
      return route.fulfill({
        json: knowledgeArtifact(FILE, {
          extractions: {
            text_extraction: {
              kind: "text_extraction",
              status: "ready",
              payload: { content: adversarialMarkdown },
            },
            captioning: {
              kind: "captioning",
              status: "ready",
              payload: { text: '<img src="/untrusted-markdown/caption">' },
            },
          },
        }),
      });
    if (pathname.endsWith("/similar"))
      return route.fulfill({ json: { files: [] } });
    return route.fulfill({ json: source });
  });
  await page.route(`**/api/py/chat/example-chat/files/${FILE}/info`, (route) =>
    route.fulfill({ json: source }),
  );
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/e2e/markdown");
  await expect(
    page.getByRole("heading", { name: "Rich content verification" }),
  ).toBeVisible();
  const main = page.getByRole("region", { name: "Main reply", exact: true });
  const subAgent = page.getByRole("region", {
    name: "Sub-agent activity",
    exact: true,
  });
  const file = page.getByRole("region", { name: "File preview", exact: true });
  await expect(main.locator(".katex-display")).toHaveCount(1);
  await expect(subAgent.locator(".katex-display")).toHaveCount(1);
  await expect(main.getByRole("table")).toContainText("42");
  await expect(main.getByRole("checkbox")).toBeDisabled();
  await expect(
    main.getByRole("link", { name: "Documentation" }),
  ).toHaveAttribute("href", "https://example.test/docs");
  await expect(
    main.getByRole("link", { name: "Documentation" }),
  ).toHaveAttribute("rel", "noreferrer noopener");
  await expect(main.locator("a[data-footnote-ref]")).toHaveAttribute(
    "href",
    /#user-content-fn-/,
  );
  await expect(
    main.getByRole("link", { name: "Scoped source" }),
  ).toHaveAttribute("href", `/c/example-chat/files/${FILE}`);
  await expect(
    page
      .getByRole("region", { name: "Retrieved sources" })
      .getByRole("link", { name: "reference.md" }),
  ).toHaveAttribute("href", `/c/example-chat/files/${FILE}`);
  await expect(file.locator("pre")).toHaveText(adversarialMarkdown);
  for (const region of [main, subAgent, file]) {
    await expect(
      region.locator(
        "iframe,form,object,embed,img,style,link,script,base,meta,video,source",
      ),
    ).toHaveCount(0);
    await expect(
      region.locator(
        "#untrusted-overlay,#untrusted-math-id,.untrusted-math-class,[style*=fixed],[src],[srcset],[poster],[onerror],[onload]",
      ),
    ).toHaveCount(0);
  }
  await expect(
    main.getByText("[Image omitted: Remote tracker]", { exact: true }),
  ).toBeVisible();
  await expect(main.getByRole("link", { name: /^unsafe/ })).toHaveCount(0);
  await main.getByRole("button").click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("const text = \"<iframe src='/untrusted-markdown/code'></iframe>\";");
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __markdownExecuted?: boolean })
          .__markdownExecuted,
    ),
  ).toBeUndefined();
  expect(resourceRequests).toEqual([]);
  expect(errors).toEqual([]);
});
