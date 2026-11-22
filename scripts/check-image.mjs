#!/usr/bin/env node
// US-91.2: the built image starts and serves, as CI checks it before a release.
//
//   pnpm check:image [--image asterism:local] [--max-size-gb 5.25] [--variant cpu|gpu]
//
// Starts the image on a fresh volume with generated, throwaway secrets, waits
// for its health check, and checks that both databases were migrated, the
// sign-in page and both health endpoints answer, every process runs as
// UID 10001, and the local-image packages match the build (US-94.2: none in
// the CPU image, the default; all of them in a TORCH_VARIANT=gpu build). Then it checks the image against a size budget, printing the
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
    "Make it smaller, or raise DEFAULT_MAX_SIZE_GB in scripts/check-image.mjs as a decision. Largest layers:",
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

// The packages of the backend's local-image extra (US-94.2).
export const LOCAL_IMAGE_PACKAGES = [
  "torch",
  "torchvision",
  "diffusers",
  "accelerate",
];

/** Problems with which local-image packages the image's backend can import. */
export function localImageProblems(importable, variant) {
  const present = LOCAL_IMAGE_PACKAGES.filter((name) => importable[name]);
  const absent = LOCAL_IMAGE_PACKAGES.filter((name) => !importable[name]);
  if (variant === "cpu" && present.length)
    return [
      `The CPU image can import ${present.join(", ")}; it must not include the local-image extra`,
    ];
  if (variant === "gpu" && absent.length)
    return [
      `The GPU image cannot import ${absent.join(", ")}; it must include the local-image extra`,
    ];
  return [];
}

const importCheck = `
import importlib.util, json, sys
print(json.dumps({name: importlib.util.find_spec(name) is not None for name in sys.argv[1:]}))
`;

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

async function checkContainer(image, variant) {
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

    const importable = JSON.parse(
      docker([
        "exec",
        name,
        "/app/apps/backend/.venv/bin/python",
        "-c",
        importCheck,
        ...LOCAL_IMAGE_PACKAGES,
      ]),
    );
    const local = localImageProblems(importable, variant);
    if (local.length) throw new Error(local.join("\n"));
    console.log(
      variant === "cpu"
        ? `ok: the backend cannot import ${LOCAL_IMAGE_PACKAGES.join(", ")}`
        : `ok: the backend can import ${LOCAL_IMAGE_PACKAGES.join(", ")}`,
    );
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

/**
 * The image size budget (unpacked), the one place it is set: CI and the release
 * workflow use this default, so a local run checks the same budget. Raised from
 * 5 on 2026-11-21 until EPIC-94 takes torch out of the image; change it only as
 * a decision, noted in the release notes.
 */
export const DEFAULT_MAX_SIZE_GB = "5.25";

async function main() {
  const { values } = parseArgs({
    options: {
      image: { type: "string", default: "asterism:local" },
      "max-size-gb": { type: "string", default: DEFAULT_MAX_SIZE_GB },
      variant: { type: "string", default: "cpu" },
    },
  });
  if (!["cpu", "gpu"].includes(values.variant))
    throw new Error(`--variant must be cpu or gpu, not ${values.variant}`);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/.test(values.image))
    throw new Error(`Not an image name: ${values.image}`);
  const maxGb = Number(values["max-size-gb"]);
  if (!(maxGb > 0))
    throw new Error(`Not a size in GB: ${values["max-size-gb"]}`);
  docker(["image", "inspect", values.image]);
  checkSize(values.image, maxGb * 1e9);
  await checkContainer(values.image, values.variant);
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
