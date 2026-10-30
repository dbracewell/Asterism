import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

const testStorageRoot =
  process.env.STORAGE_ROOT ?? resolve(process.cwd(), "test-results/storage");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // The isolated backend and Next development server share the GitHub runner.
  // Serial CI execution avoids resource contention during fresh setup.
  workers: process.env.CI ? 1 : undefined,
  retries: 0,
  // Visual baselines are macOS renders; font rasterization differs elsewhere.
  // Other platforms (CI on Linux) skip only the screenshot comparisons, so
  // every structural, contrast and accessibility assertion still runs.
  ignoreSnapshots: process.platform !== "darwin",
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["json", { outputFile: "test-results/results.json" }],
  ],
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      "node node_modules/auth/dist/index.mjs migrate --config ./src/lib/auth-cli.ts --yes && pnpm exec next dev --port 3100 --webpack",
    url: "http://localhost:3100/e2e/sub-agent",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      ASTERISM_CONFIG_PROFILE: "test",
      PUBLIC_URL: "http://localhost:3100",
      // Keep `pnpm exec playwright test` usable outside the isolated CI runner.
      // The runner supplies a unique value; this fallback is confined to the
      // ephemeral E2E auth database under test-results.
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET ??
        "e2e-playwright-local-auth-secret-6b3f29c17ea840df",
      STORAGE_ROOT: testStorageRoot,
      BETTER_AUTH_DB_PATH:
        process.env.BETTER_AUTH_DB_PATH ?? resolve(testStorageRoot, "users.db"),
    },
  },
  projects: [
    {
      name: "fresh-install",
      testMatch: /home\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      testIgnore: /home\.spec\.ts/,
      dependencies: ["fresh-install"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
