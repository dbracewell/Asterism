import { expect, test } from "./support/test";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";

// Runs in the first-run project: after the fresh-install checks and before any
// account-creating Chromium spec, so this administrator is the first account
// and the instance has no active models. Auth, routing, storage and provider
// discovery are real; only the external model endpoint is a local double.
test.describe.configure({ mode: "serial" });
test.skip(
  process.env.ASTERISM_ISOLATED_E2E !== "true",
  "Use scripts/run-isolated-e2e.mjs for real authentication",
);

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
  await models.getByLabel("First-run alpha").check();
  await models.getByLabel("First-run beta").check();
  await models.getByLabel("Default model").click();
  await page.getByRole("option", { name: "First-run beta" }).click();
  await models.getByRole("button", { name: "Continue" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("combobox", { name: "Chat model", exact: true }),
  ).toContainText("First-run beta");

  // Once a model is active, the step no longer applies.
  await page.goto("/setup");
  await expect(page).toHaveURL(/\/$/);

  // Leave later specs the instance they expect: no providers.
  const token = await (await page.request.get("/api/auth/token")).json();
  const cleared = await page.request.put("/api/py/settings/app/providers", {
    headers: { Authorization: `Bearer ${token.token}` },
    data: { llm_providers: [], draft_model_id: null },
  });
  expect(cleared.ok()).toBeTruthy();
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
