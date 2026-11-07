import { expect, test } from "./support/test";
import { createServer, type Server } from "node:http";
import {
  createCipheriv,
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
} from "node:crypto";

// Runs in the first-run project: after the fresh-install checks and before any
// account-creating Chromium spec, so this administrator is the first account
// and the instance has no active models. Auth, routing, storage and provider
// discovery are real; only the external model endpoint is a local double.
test.describe.configure({ mode: "serial" });
test.skip(
  process.env.ASTERISM_ISOLATED_E2E !== "true",
  "Use scripts/run-isolated-e2e.mjs for real authentication",
);

const FILE_PASSPHRASE = "first-run file passphrase";

/**
 * A settings file with no providers, sealed independently of the server's code.
 * It keeps the instance's tools, as a real export would: import always applies
 * them, and later specs on this instance depend on them.
 */
function settingsFileWithoutProviders(activeTools: string[]) {
  const salt = randomBytes(16);
  const key = scryptSync(FILE_PASSPHRASE, salt, 32, {
    N: 2 ** 17,
    r: 8,
    p: 1,
    maxmem: 256 * 1024 * 1024,
  });
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-128-cbc", key.subarray(16), iv);
  const plain = JSON.stringify({
    exported_at: 1_700_000_000,
    active_tools: activeTools,
  });
  const time = Buffer.alloc(8);
  time.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000)));
  const body = Buffer.concat([
    Buffer.from([0x80]),
    time,
    iv,
    cipher.update(plain),
    cipher.final(),
  ]);
  const mac = createHmac("sha256", key.subarray(0, 16)).update(body).digest();
  return JSON.stringify({
    format: "asterism.settings-export",
    format_version: 1,
    salt: salt.toString("base64"),
    // Fernet tokens keep their padding, which Node's base64url would strip.
    ciphertext: Buffer.concat([body, mac])
      .toString("base64")
      .replaceAll("+", "-")
      .replaceAll("/", "_"),
  });
}

let provider: Server;
let providerUrl = "";
test.beforeAll(async () => {
  provider = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/v1/models") {
      response.end(
        JSON.stringify({
          data: ["First-run alpha", "First-run beta"].map((id) => ({ id })),
        }),
      );
      return;
    }
    response.statusCode = 404;
    response.end("{}");
  });
  await new Promise<void>((resolve) =>
    provider.listen(0, "127.0.0.1", resolve),
  );
  const address = provider.address();
  if (!address || typeof address === "string")
    throw new Error("Missing local provider address");
  providerUrl = `http://127.0.0.1:${address.port}/v1`;
});
test.afterAll(
  () => new Promise<void>((resolve) => provider.close(() => resolve())),
);

test("the administrator connects a provider right after creating the account", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/sign-in");
  const account = page.getByRole("form", { name: "Administrator setup" });
  await account.getByLabel("Name", { exact: true }).fill("First admin");
  await account.getByLabel("Email").fill(`${randomUUID()}@example.test`);
  await account.getByLabel("Password", { exact: true }).fill("First-run-321!");
  await account.getByLabel("Admin Passkey").fill(process.env.ADMIN_PASSPHRASE!);
  await account.getByRole("button", { name: "Sign up" }).click();

  await expect(page).toHaveURL(/\/setup$/);
  const steps = page.getByRole("list", { name: "First-run setup" });
  await expect(steps.locator('[aria-current="step"]')).toContainText(
    "Add a model provider",
  );
  const connect = page.getByRole("form", { name: "Add a model provider" });
  await expect(connect).toBeVisible();

  // A settings file can stand in for this step. This one holds no models, so
  // setup explains that and leads back here, leaving the instance unconfigured.
  const session = await (await page.request.get("/api/auth/token")).json();
  const tools = await page.request.get("/api/py/settings/app/tools", {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  const activeTools = (await tools.json()).active_tools;
  expect(activeTools.length).toBeGreaterThan(0);
  await page
    .getByRole("button", { name: "Import a settings file instead" })
    .click();
  await page.getByLabel("Settings file").setInputFiles({
    name: "settings.json",
    mimeType: "application/json",
    buffer: Buffer.from(settingsFileWithoutProviders(activeTools)),
  });
  await page.getByLabel("File passphrase").fill("not the passphrase");
  await page.getByRole("button", { name: "Preview import" }).click();
  await expect(page.getByText("Could not open this file")).toBeVisible();
  await page.getByLabel("File passphrase").fill(FILE_PASSPHRASE);
  await page.getByRole("button", { name: "Preview import" }).click();
  await page.getByRole("button", { name: "Import settings" }).click();
  await expect(page.getByText(/no active models/)).toBeVisible();
  await page.getByRole("button", { name: "Set up a provider" }).click();
  await expect(connect).toBeVisible();

  // Reloading returns to the step; skipping reaches the new-chat page.
  await page.reload();
  await expect(connect).toBeVisible();
  await connect.getByRole("link", { name: "Skip for now" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: "What should we work on?" }),
  ).toBeVisible();

  // With still no active models, the step remains available.
  await page.goto("/setup");
  await connect.getByRole("radio", { name: "OpenAI-compatible" }).click();
  await connect.getByLabel("Provider name").fill("First-run provider");
  await connect.getByLabel("Base URL").fill("http://127.0.0.1:1/v1");
  await connect.getByLabel("API key").fill("synthetic-provider-key");
  await connect
    .getByRole("button", { name: "Connect and discover models" })
    .click();
  await expect(connect.getByRole("alert")).toContainText(
    "Model discovery failed.",
  );
  await expect(connect.getByLabel("API key")).toHaveValue(
    "synthetic-provider-key",
  );
  await connect.getByLabel("Base URL").fill(providerUrl);
  await connect.getByRole("button", { name: "Retry" }).click();

  const models = page.getByRole("form", { name: "Enable models" });
  await models.getByLabel("First-run alpha", { exact: true }).check();
  await models.getByLabel("First-run beta", { exact: true }).check();
  // The local double reports no capabilities, so both are unknown.
  const alphaTools = models.getByRole("checkbox", {
    name: "Tools for First-run alpha",
  });
  await expect(alphaTools).toHaveAccessibleDescription("(Unknown)");
  await alphaTools.check();
  await models.getByLabel("Default model").click();
  await page.getByRole("option", { name: "First-run beta" }).click();
  await models.getByLabel("Draft model").click();
  await page.getByRole("option", { name: "First-run alpha" }).click();
  await models.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("status")).toHaveText(
    "You're ready to start your exploration.",
  );
  await page.getByRole("button", { name: "Start chatting" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("combobox", { name: "Chat model", exact: true }),
  ).toContainText("First-run beta");

  // Once a model is active, the step no longer applies.
  await page.goto("/setup");
  await expect(page).toHaveURL(/\/$/);

  // The draft model was stored, so Admin settings → Providers needs no visit.
  const token = await (await page.request.get("/api/auth/token")).json();
  const settings = await page.request.get("/api/py/settings/app/providers", {
    headers: { Authorization: `Bearer ${token.token}` },
  });
  expect(settings.ok()).toBeTruthy();
  const stored = await settings.json();
  expect(stored.draft_model?.name).toBe("First-run alpha");
  expect(stored.llm_providers).toHaveLength(1);
  // Checked capabilities are manual; untouched unknown ones stay unknown.
  const catalog = await page.request.get(
    `/api/py/settings/app/providers/${stored.llm_providers[0].id}/models?limit=10`,
    { headers: { Authorization: `Bearer ${token.token}` } },
  );
  expect(catalog.ok()).toBeTruthy();
  const byName = Object.fromEntries(
    (
      (await catalog.json()).models as {
        name: string;
        supports_tools: boolean | null;
        tools_source: string;
        supports_vision: boolean | null;
        vision_source: string;
      }[]
    ).map((model) => [model.name, model]),
  );
  expect(byName["First-run alpha"]).toMatchObject({
    supports_tools: true,
    tools_source: "manual",
    supports_vision: null,
    vision_source: "unknown",
  });
  expect(byName["First-run beta"]).toMatchObject({
    supports_tools: null,
    tools_source: "unknown",
  });

  const headers = { Authorization: `Bearer ${token.token}` };
  const clearProviders = async () => {
    const cleared = await page.request.put("/api/py/settings/app/providers", {
      headers,
      data: { llm_providers: [], draft_model_id: null },
    });
    expect(cleared.ok()).toBeTruthy();
  };

  // Export, lose the providers, and rebuild from the file during setup.
  const exported = await page.request.post(
    "/api/py/settings/app/transfer/export",
    { headers, data: { passphrase: FILE_PASSPHRASE } },
  );
  expect(exported.ok()).toBeTruthy();
  const settingsFile = await exported.text();
  expect(settingsFile).not.toContain("First-run provider");
  await clearProviders();

  await page.goto("/setup");
  await page
    .getByRole("button", { name: "Import a settings file instead" })
    .click();
  await page.getByLabel("Settings file").setInputFiles({
    name: "settings.json",
    mimeType: "application/json",
    buffer: Buffer.from(settingsFile),
  });
  await page.getByLabel("File passphrase").fill(FILE_PASSPHRASE);
  await page.getByRole("button", { name: "Preview import" }).click();
  await expect(page.getByText(/Add First-run provider/)).toBeVisible();
  await page.getByRole("button", { name: "Import settings" }).click();
  const continueSetup = page.getByRole("button", { name: "Continue" });
  await expect(continueSetup).toBeDisabled();
  await page.getByRole("combobox", { name: "Default model" }).click();
  await page.getByRole("option", { name: /First-run alpha/ }).click();
  await continueSetup.click();
  await page.getByRole("button", { name: "Start chatting" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: "What should we work on?" }),
  ).toBeVisible();
  const restored = await page.request.get("/api/py/settings/app/providers", {
    headers,
  });
  const { llm_providers: providers } = await restored.json();
  expect(providers).toHaveLength(1);
  expect(providers[0]).toMatchObject({ name: "First-run provider" });

  // Leave later specs the instance they expect: no providers.
  await clearProviders();
});

test("a standard user never sees the provider step", async ({ page }) => {
  const signup = await page.request.post(
    `/api/auth/sign-up/email?adminKey=${encodeURIComponent(process.env.ADMIN_PASSPHRASE!)}&role=user`,
    {
      data: {
        name: "Standard user",
        email: `${randomUUID()}@example.test`,
        password: "Standard-user-321!",
      },
    },
  );
  expect(signup.ok()).toBeTruthy();
  const provision = await page.request.post("/api/py/users/", {
    data: {
      user_id: (await signup.json()).user.id,
      system_key: process.env.SYSTEM_KEY,
    },
  });
  expect(provision.ok()).toBeTruthy();
  await page.goto("/setup");
  await expect(page).toHaveURL(/\/$/);
});
