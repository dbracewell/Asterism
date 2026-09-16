import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getMigrations } from "better-auth/db/migration";

const dbPath = process.env.BETTER_AUTH_DB_PATH;
if (!dbPath) {
  throw new Error("BETTER_AUTH_DB_PATH must be set before running migrations");
}
mkdirSync(dirname(dbPath), { recursive: true });

// Import after creating the directory: the shared options open the database.
const { authOptions } = await import("./src/lib/auth-options.ts");
try {
  const { runMigrations } = await getMigrations(authOptions);
  await runMigrations();
  console.log("Frontend auth database migrations complete");
} finally {
  authOptions.database.close();
}
