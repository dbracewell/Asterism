#!/usr/bin/env node
// Regenerates the user guide's screenshots (US-89.1).
//
//   pnpm docs:screenshots [--only chat-tutor,files-library] [--image asterism:local] [--keep]
//
// Starts a scripted model and a disposable container on a fresh volume, sets
// the instance up in the browser, seeds the fictional demo dataset through the
// API, then takes every shot in scripts/screenshots/shots.mjs. The working
// database and your own containers are never touched. Build the image first
// (`docker build -t asterism:local .`).
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { removeInstance, startInstance } from "./capacity/instance.mjs";
import { MODELS, PASSWORD, people } from "./screenshots/demo-content.mjs";
import { startDemoProvider } from "./screenshots/demo-provider.mjs";
import { seedDemo } from "./screenshots/seed.mjs";
import { VIEWPORTS, shots, validateShots } from "./screenshots/shots.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values: options } = parseArgs({
  options: {
    image: { type: "string", default: "asterism:local" },
    port: { type: "string", default: "3970" },
    only: { type: "string" },
    out: { type: "string", default: "docs/guide/images" },
    keep: { type: "boolean", default: false },
  },
});

const problems = validateShots(shots);
if (problems.length) {
  console.error(`The shot list has problems:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
const wanted = options.only
  ? new Set(options.only.split(",").map((name) => name.trim()))
  : null;
const unknown = [...(wanted ?? [])].filter(
  (name) => !shots.some((shot) => shot.name === name),
);
if (unknown.length) {
  console.error(`Unknown shots: ${unknown.join(", ")}`);
  process.exit(1);
}
const selected = (shot) => !wanted || wanted.has(shot.name);

// Playwright is a frontend dependency; load it from there.
const { chromium } = createRequire(join(root, "apps/frontend/package.json"))(
  "@playwright/test",
);

const out = resolve(root, options.out);
mkdirSync(out, { recursive: true });
const log = (message) =>
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${message}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One fixed look for every picture: light Atlas theme, default font size, sidebar open, no motion. */
async function newContext(browser, base, viewport = "desktop") {
  const size = VIEWPORTS[viewport];
  const context = await browser.newContext({
    viewport: size,
    deviceScaleFactor: viewport === "phone" ? 2 : 1.25,
    colorScheme: "light",
    locale: "en-US",
    timezoneId: "America/New_York",
    reducedMotion: "reduce",
  });
  await context.addCookies(
    [
      ["sidebar_state", "true"],
      ["asterism-custom-theme-name", "atlas"],
      ["asterism-font-size", "16px"],
    ].map(([name, value]) => ({ name, value, url: base })),
  );
  return context;
}

async function settle(page) {
  // Pages keep polling, so "network idle" is a short best effort.
  await page
    .waitForLoadState("networkidle", { timeout: 2_000 })
    .catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  // No hover effects or focus rings in the pictures.
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.activeElement?.blur?.());
  await sleep(400);
}

function imagePath(shot) {
  return shot.file ? resolve(root, shot.file) : join(out, `${shot.name}.png`);
}

async function capture(page, shot) {
  await settle(page);
  const path = imagePath(shot);
  const target = shot.target ? page.locator(shot.target).first() : page;
  await target.screenshot({ path, animations: "disabled", caret: "hide" });
  log(`Saved ${shot.name}`);
}

/** First-run setup in the browser, as the administrator does it. Photographs the selected setup steps. */
async function firstRun(browser, instance, stubUrl) {
  const context = await newContext(browser, instance.base);
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  const shot = (name) => shots.find((entry) => entry.name === name);
  const maybe = async (name) =>
    selected(shot(name)) && capture(page, shot(name));

  await page.goto(`${instance.base}/sign-in`);
  const account = page.getByRole("form", { name: "Administrator setup" });
  await account.getByLabel("Name", { exact: true }).fill(people.admin.name);
  await account.getByLabel("Email").fill(people.admin.email);
  await account.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await account
    .getByLabel("Admin Passkey")
    .fill(instance.secrets.ADMIN_PASSPHRASE);
  // Never photograph the real passkey.
  await account.getByLabel("Admin Passkey").evaluate((input) => {
    input.type = "password";
  });
  await maybe("setup-admin-account");
  await account.getByRole("button", { name: "Sign up" }).click();

  const connect = page.getByRole("form", { name: "Add a model provider" });
  await connect.getByRole("radio", { name: "OpenAI-compatible" }).click();
  await connect.getByLabel("Provider name").fill("Demo models");
  await connect.getByLabel("Base URL").fill(stubUrl);
  await connect.getByLabel("API key").fill("demo-key");
  await maybe("setup-connect-provider");
  await connect
    .getByRole("button", { name: "Connect and discover models" })
    .click();

  const models = page.getByRole("form", { name: "Enable models" });
  for (const model of Object.values(MODELS))
    await models.getByLabel(model, { exact: true }).check();
  // The demo models support tools, which project file search and sub-agents need.
  for (const box of await models
    .getByRole("checkbox", { name: /^Tools/ })
    .all())
    await box.check();
  await models.getByLabel("Default model").click();
  await page.getByRole("option", { name: MODELS.tutor }).click();
  await models.getByLabel("Draft model").click();
  await page.getByRole("option", { name: MODELS.writer }).click();
  await maybe("setup-enable-models");
  await models.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Start chatting" }).click();
  await context.close();
}

/** Render an HTML demo file to the PDF or PNG it stands for. */
async function renderer(browser) {
  return async (file) => {
    const page = await browser.newPage({
      viewport: { width: 800, height: 600 },
    });
    try {
      await page.setContent(file.html);
      if (file.type === "application/pdf")
        return await page.pdf({ format: "A4" });
      return await page.locator("body > *").first().screenshot();
    } finally {
      await page.close();
    }
  };
}

const provider = await startDemoProvider({
  host: "0.0.0.0",
  models: Object.values(MODELS),
});
log(`Starting ${options.image} on port ${options.port}`);
const instance = await startInstance({
  image: options.image,
  cpus: 4,
  memory: "8g",
  port: Number(options.port),
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    if (!options.keep) await removeInstance(instance);
    process.exit(130);
  });
}

const failures = [];
const browser = await chromium.launch();
try {
  log("First-run setup");
  await firstRun(
    browser,
    instance,
    `http://host.docker.internal:${provider.port}/v1`,
  );
  const ids = await seedDemo({
    instance,
    renderFile: await renderer(browser),
    log,
  });
  if (options.keep) log(`Seeded ids: ${JSON.stringify(ids)}`);

  const personas = {
    admin: people.admin,
    educator: people.educator,
    student: people.student,
    classmate: people.classmate,
  };
  for (const shot of shots.filter(
    (entry) => entry.stage !== "first-run" && selected(entry),
  )) {
    const context = await newContext(browser, instance.base, shot.viewport);
    try {
      // A visitor isn't signed in, for the sign-in, invite and reset pages.
      const person = personas[shot.as];
      if (person) {
        const signIn = await context.request.post(
          `${instance.base}/api/auth/sign-in/email`,
          {
            data: { email: person.email, password: PASSWORD },
            headers: { Origin: instance.publicUrl },
          },
        );
        if (!signIn.ok())
          throw new Error(`sign-in as ${shot.as} failed: ${signIn.status()}`);
      }
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      await page.goto(instance.base + shot.path(ids));
      for (const text of shot.ready)
        await page.getByText(text, { exact: false }).first().waitFor();
      await shot.steps?.(page, ids);
      await capture(page, shot);
    } catch (error) {
      failures.push(`${shot.name}: ${error.message.split("\n")[0]}`);
      log(`FAILED ${shot.name}`);
    } finally {
      await context.close();
    }
  }
} catch (error) {
  failures.push(`setup: ${error.stack ?? error.message}`);
} finally {
  await browser.close();
  await provider.close();
  if (options.keep)
    log(
      `Kept ${instance.name} at ${instance.base}; remove it with docker rm -f and docker volume rm`,
    );
  else await removeInstance(instance);
}

// Images in the folder that no shot produces are left from renamed or removed shots.
const known = new Set(shots.map((shot) => `${shot.name}.png`));
const stale = existsSync(out)
  ? readdirSync(out).filter((name) => name.endsWith(".png") && !known.has(name))
  : [];
if (stale.length)
  log(`Not in the shot list (delete if unused): ${stale.join(", ")}`);

if (failures.length) {
  console.error(
    `\n${failures.length} shot(s) could not be taken:\n- ${failures.join("\n- ")}`,
  );
  process.exit(1);
}
log("All screenshots taken");
