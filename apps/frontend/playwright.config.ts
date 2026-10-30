import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

const testStorageRoot =
  process.env.STORAGE_ROOT ?? resolve(process.cwd(), "test-results/storage");

// Specs run against a production build: `next dev` compiles routes and chunks
// on demand and Fast-Refreshes open pages after each compile, so parallel
// workers saw remounts and stalled queries that varied by run. Set
// E2E_DEV_SERVER=1 to iterate against `next dev` without rebuilding.
const devServer = process.env.E2E_DEV_SERVER === "1";
const server = devServer
  ? "pnpm exec next dev --port 3100 --webpack"
  : "pnpm exec next build && pnpm exec next start --port 3100";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // The isolated backend and the Next server share the GitHub runner. Serial
  // CI execution avoids resource contention during fresh setup.
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
    command: `node node_modules/auth/dist/index.mjs migrate --config ./src/lib/auth-cli.ts --yes && ${server}`,
    url: "http://localhost:3100/e2e/sub-agent",
    reuseExistingServer: false,
    timeout: devServer ? 120_000 : 600_000,
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
