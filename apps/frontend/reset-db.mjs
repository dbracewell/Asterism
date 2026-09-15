import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

async function deleteFile(filePath) {
  try {
    rmSync(filePath);
    console.log(`Successfully deleted ${filePath}`);
  } catch (error) {
    console.error(`Error deleting file: ${error.message}`);
  }
}

deleteFile(process.env.BETTER_AUTH_DB_PATH);
execSync("pnpm dlx auth@latest migrate --yes", { stdio: "inherit" });
