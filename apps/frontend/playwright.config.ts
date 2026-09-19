import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

const testStorageRoot = resolve(process.cwd(), "test-results/storage");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3100",
    trace: "on-first-retry",
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
      STORAGE_ROOT: testStorageRoot,
      BETTER_AUTH_DB_PATH: resolve(testStorageRoot, "users.db"),
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
