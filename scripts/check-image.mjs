#!/usr/bin/env node
// US-91.2: the built image starts and serves, as CI checks it before a release.
//
//   pnpm check:image [--image asterism:local] [--max-size-gb 5]
//
// Starts the image on a fresh volume with generated, throwaway secrets, waits
// for its health check, and checks that both databases were migrated, the
// sign-in page and both health endpoints answer, and every process runs as
// UID 10001. Then it checks the image against a size budget, printing the
// largest layers when it is over, so that growth is a decision. The container
// and volume are removed afterwards.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { parseDockerSize } from "./capacity/stats.mjs";

export const RUNTIME_UID = "10001";
// Better Auth's core tables and the JWT plugin's keys.
export const AUTH_TABLES = [
  "user",
  "session",
  "account",
  "verification",
  "jwks",
];
const HEALTHY_TIMEOUT_MS = 10 * 60 * 1000;

function docker(args, options = {}) {
  const result = spawnSync("docker", args, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    throw new Error(
      `docker ${args[0]} failed: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return result.stdout.trim();
}

/** Layers from `docker history`, largest first. */
export function largestLayers(history, count = 8) {
  return history
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [size, ...command] = line.split("\t");
      return {
        bytes: parseDockerSize(size) ?? 0,
        size,
        command: command.join("\t"),
      };
    })
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, count);
}

/** A failure message when the image is over budget, or null. */
export function sizeProblem(bytes, maxBytes, layers) {
  if (bytes == null) return "Could not read the image size";
  if (bytes <= maxBytes) return null;
  const parts = layers.map(
    ({ size, command }) =>
      `  ${size.padStart(8)}  ${command.replace(/\s+/g, " ").slice(0, 100)}`,
  );
  return [
    `The image is ${(bytes / 1e9).toFixed(2)} GB, over the ${(maxBytes / 1e9).toFixed(2)} GB budget.`,
    "Make it smaller, or raise the budget in CI (--max-size-gb) as a decision. Largest layers:",
    ...parts,
  ].join("\n");
}

/** Problems with the real UIDs of the container's processes. */
export function uidProblems(uids) {
  const others = [...new Set(uids)].filter((uid) => uid !== RUNTIME_UID);
  if (uids.length === 0) return ["No processes were found in the container"];
  return others.length
    ? [`Processes run as UID ${others.join(", ")}, not only ${RUNTIME_UID}`]
    : [];
}

async function waitHealthy(container) {
  const deadline = Date.now() + HEALTHY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const state = JSON.parse(
      docker(["inspect", "--format", "{{json .State}}", container]),
    );
    if (!state.Running)
      throw new Error(
        `The container exited (code ${state.ExitCode}) before becoming healthy`,
      );
    if (state.Health?.Status === "healthy") return;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(
    `The container was not healthy within ${HEALTHY_TIMEOUT_MS / 60000} minutes`,
  );
}

async function get(base, path) {
  const response = await fetch(`${base}${path}`, { redirect: "manual" });
  if (response.status !== 200)
    throw new Error(`GET ${path} answered ${response.status}`);
  return response;
}

const databaseCheck = String.raw`
import json, sqlite3
def tables(path):
    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as connection:
        return [row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")]
with sqlite3.connect("file:/storage/database.db?mode=ro", uri=True) as connection:
    revision = connection.execute("SELECT version_num FROM alembic_version").fetchone()
print(json.dumps({"auth": tables("/storage/users.db"), "revision": revision and revision[0]}))
`;

async function checkContainer(image) {
  const name = `asterism-image-check-${randomBytes(4).toString("hex")}`;
  const secrets = Object.fromEntries(
    ["BETTER_AUTH_SECRET", "SYSTEM_KEY", "ADMIN_PASSPHRASE"].map((key) => [
      key,
      randomBytes(32).toString("base64url"),
    ]),
  );
  try {
    // Secrets reach the container through the environment, never the command line.
    docker(
      [
        "run",
        "-d",
        "--name",
        name,
        "--stop-timeout",
        "30",
        "-p",
        "127.0.0.1::3000",
        "-v",
        `${name}:/storage`,
        "-e",
        "BETTER_AUTH_SECRET",
        "-e",
        "SYSTEM_KEY",
        "-e",
        "ADMIN_PASSPHRASE",
        image,
      ],
      { env: { ...process.env, ...secrets } },
    );
    await waitHealthy(name);
    console.log("ok: the container is healthy");

    const { auth, revision } = JSON.parse(
      docker([
        "exec",
        name,
        "/app/apps/backend/.venv/bin/python",
        "-c",
        databaseCheck,
      ]),
    );
    const missing = AUTH_TABLES.filter((table) => !auth.includes(table));
    if (missing.length)
      throw new Error(
        `The auth migration did not run: missing ${missing.join(", ")}`,
      );
    if (!revision)
      throw new Error("The backend database has no schema revision");
    console.log(
      `ok: the auth migration ran, and the backend database is at ${revision}`,
    );

    const base = `http://127.0.0.1:${docker(["port", name, "3000/tcp"]).split("\n")[0].split(":").pop()}`;
    const page = await (await get(base, "/sign-in")).text();
    if (!/<html/i.test(page)) throw new Error("/sign-in did not return a page");
    await get(base, "/api/py/health/ready");
    await get(base, "/api/health");
    console.log(
      "ok: /sign-in, /api/py/health/ready and /api/health answer 200",
    );

    const uids = docker([
      "exec",
      name,
      "sh",
      "-c",
      "for status in /proc/[0-9]*/status; do sed -n 's/^Uid:[[:space:]]*\\([0-9]*\\).*/\\1/p' \"$status\"; done",
    ])
      .split("\n")
      .filter(Boolean);
    const problems = uidProblems(uids);
    if (problems.length) throw new Error(problems.join("\n"));
    console.log(`ok: all ${uids.length} processes run as UID ${RUNTIME_UID}`);
  } catch (error) {
    const logs = spawnSync("docker", ["logs", "--tail", "80", name], {
      encoding: "utf8",
    });
    console.error(`--- container logs ---\n${logs.stdout}${logs.stderr}`);
    for (const secret of Object.values(secrets)) {
      if (`${logs.stdout}${logs.stderr}`.includes(secret))
        console.error("A secret appeared in the logs");
    }
    throw error;
  } finally {
    spawnSync("docker", ["rm", "-f", "-v", name], { stdio: "ignore" });
    spawnSync("docker", ["volume", "rm", name], { stdio: "ignore" });
  }
}

function checkSize(image, maxBytes) {
  // `docker image ls` reports the unpacked size with either image store;
  // `docker image inspect` reports the compressed size under containerd.
  const bytes = parseDockerSize(
    docker(["image", "ls", "--format", "{{.Size}}", image]).split("\n")[0],
  );
  const history = docker([
    "history",
    "--no-trunc",
    "--format",
    "{{.Size}}\t{{.CreatedBy}}",
    image,
  ]);
  const problem = sizeProblem(bytes, maxBytes, largestLayers(history));
  if (problem) throw new Error(problem);
  console.log(
    `ok: the image is ${(bytes / 1e9).toFixed(2)} GB, within the ${(maxBytes / 1e9).toFixed(2)} GB budget`,
  );
}

async function main() {
  const { values } = parseArgs({
    options: {
      image: { type: "string", default: "asterism:local" },
      "max-size-gb": { type: "string", default: "5" },
    },
  });
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/.test(values.image))
    throw new Error(`Not an image name: ${values.image}`);
  const maxGb = Number(values["max-size-gb"]);
  if (!(maxGb > 0))
    throw new Error(`Not a size in GB: ${values["max-size-gb"]}`);
  docker(["image", "inspect", values.image]);
  checkSize(values.image, maxGb * 1e9);
  await checkContainer(values.image);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
