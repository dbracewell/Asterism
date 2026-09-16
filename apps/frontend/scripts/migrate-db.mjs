import { execSync as runSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const DB_PATH =
  process.env.BETTER_AUTH_DB_PATH ||
  join(process.env.STORAGE_ROOT || "/storage", "users.db");

mkdirSync(dirname(DB_PATH), { recursive: true });
console.log(`Migrating database at ${DB_PATH}...`);

runSync("npx auth@latest migrate --yes", {
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: `file:${DB_PATH}`,
    BETTER_AUTH_DB_PATH: `file:${DB_PATH}`,
  },
});
