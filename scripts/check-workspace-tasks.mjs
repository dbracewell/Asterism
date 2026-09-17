import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const root = readJson("package.json");
const backend = readJson("apps/backend/package.json");
const frontend = readJson("apps/frontend/package.json");

const required = {
  backend: ["lint", "test", "typecheck"],
  frontend: ["build", "lint", "test", "typecheck"],
};

for (const task of required.backend) {
  assert.ok(backend.scripts?.[task], `backend is missing its ${task} script`);
  assert.match(
    root.scripts?.[task] ?? "",
    /--filter @asterism\/backend/,
    `root ${task} does not invoke the backend workspace`,
  );
}
for (const task of required.frontend) {
  assert.ok(frontend.scripts?.[task], `frontend is missing its ${task} script`);
  assert.match(
    root.scripts?.[task] ?? "",
    /--filter @asterism\/frontend/,
    `root ${task} does not invoke the frontend workspace`,
  );
}

assert.equal(existsSync("turbo.json"), false, "turbo.json must not exist");
assert.equal(
  root.devDependencies?.turbo,
  undefined,
  "Turbo dependency remains",
);

const activeFiles = [
  "package.json",
  "pnpm-lock.yaml",
  "Dockerfile",
  ".github/workflows/ci.yml",
  "AGENTS.md",
  "README.md",
  "apps/backend/README.md",
  "apps/frontend/README.md",
];
for (const path of activeFiles) {
  const content = readFileSync(path, "utf8").replaceAll("turbopack", "");
  assert.doesNotMatch(
    content,
    /(?:\bturbo(?:repo)?\b|\.turbo)/i,
    `${path} contains an active Turbo reference`,
  );
}

console.log("Workspace task configuration is complete and Turbo-free.");
