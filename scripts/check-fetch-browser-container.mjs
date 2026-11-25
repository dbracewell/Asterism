#!/usr/bin/env node
// US-90.8: the web fetch tool's headless Chromium works inside the image.
//
//   pnpm check:fetch-browser-container [--image asterism:local]
//
// Runs as the image's own non-root user, launches the browser through the fetch
// tool's pooled launcher (so with its launch arguments), and renders a page
// whose text only JavaScript writes. The page is served from inside the
// browser context, as the tool's request routing does: nothing reaches the
// network, and no volume, database or secret is used.
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { image: { type: "string", default: "asterism:local" } },
});
if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/.test(values.image)) {
  console.error(`Not an image name: ${values.image}`);
  process.exit(2);
}

const check = String.raw`
import asyncio, os, pwd
from asterism.common import headless_browser
from asterism.domains.tools.builtin import fetch

PAGE = "<html><body><main id='out'></main><script>document.getElementById('out').textContent = 'Rendered by JavaScript';</script></body></html>"

async def main():
    user = pwd.getpwuid(os.getuid()).pw_name
    assert os.getuid() != 0, "the check must run as the image's non-root user"
    # The fetch tool uses the shared pool (ADR-0082), as the export renderer does.
    assert fetch.acquire_browser is headless_browser.acquire_browser
    browser = await headless_browser.acquire_browser()
    try:
        context = await browser.new_context(service_workers="block")
        await context.route("**/*", lambda route: route.fulfill(status=200, content_type="text/html", body=PAGE))
        page = await context.new_page()
        await page.goto("https://example.test/", wait_until="networkidle", timeout=15000)
        html = await page.content()
        await context.close()
    finally:
        await headless_browser.close_browser()
    assert "Rendered by JavaScript" in html, html
    print(f"ok: {browser.browser_type.name} {browser.version} rendered JavaScript as {user} with {len(headless_browser.BROWSER_LAUNCH_ARGS)} launch arguments")

asyncio.run(main())
`;

const result = spawnSync(
  "docker",
  [
    "run",
    "--rm",
    "-i",
    "--network",
    "none",
    "-e",
    "ASTERISM_CONFIG_PROFILE=test",
    "-w",
    "/app/apps/backend",
    "--entrypoint",
    "/app/apps/backend/.venv/bin/python",
    values.image,
    "-",
  ],
  { input: check, encoding: "utf8", timeout: 180_000 },
);
if (result.error) throw result.error;
process.stdout.write(result.stdout);
if (result.status !== 0) {
  process.stderr.write(result.stderr);
  console.error("The fetch tool's browser did not work in the image.");
  process.exit(1);
}
