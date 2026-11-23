#!/usr/bin/env node
// US-91.2: the built image starts and serves, as CI checks it before a release.
//
//   pnpm check:image [--image asterism:local] [--max-size-gb 4.25] [--variant cpu|gpu]
//
// Starts the image on a fresh volume with generated, throwaway secrets, waits
// for its health check, and checks that both databases were migrated, the
// sign-in page and both health endpoints answer, every process runs as
// UID 10001, and the local-image packages match the build (US-94.2: none in
// the CPU image, the default; all of them in a TORCH_VARIANT=gpu build), and
// that no test tooling or pip is in the image (US-95.1), and that each Debian
// package the runtime stage upgrades past its base (BASE_LAG_UPGRADES, US-95.4)
// is newer in the image than in the base. Then it checks the image against a size budget, printing the
// largest layers when it is over, so that growth is a decision. The container
// and volume are removed afterwards.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
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

// Test tooling that must not reach the image's node_modules (US-95.1).
export const DEVELOPMENT_PACKAGES = ["vitest", "vite", "jsdom"];

/**
 * The package name of a directory in pnpm's virtual store, `node_modules/.pnpm`:
 * `vite@8.0.16_@types+node@20.19.41` is `vite`, `@scope+name@1.0.0` is
 * `@scope/name`. Directories that aren't packages (`node_modules`, `lock.yaml`)
 * give null.
 */
export function pnpmStorePackage(entry) {
  const at = entry.indexOf("@", entry.startsWith("@") ? 1 : 0);
  if (at <= 0) return null;
  return entry.slice(0, at).replace("+", "/");
}

/**
 * Problems with development packages in the image: test tooling in pnpm's
 * store, or pip importable by the system Python, which only the build stages
 * need (US-95.1).
 */
export function developmentPackageProblems(storeEntries, pipImportable) {
  const names = new Set(storeEntries.map(pnpmStorePackage));
  const present = DEVELOPMENT_PACKAGES.filter((name) => names.has(name));
  const problems = [];
  if (present.length)
    problems.push(
      `The image's node_modules has ${present.join(", ")}; test tooling must not reach the production install`,
    );
  if (pipImportable)
    problems.push(
      "The image's system Python can import pip; the runtime stage must remove it",
    );
  return problems;
}

/**
 * The runtime stage's base image and the Debian packages it upgrades past that
 * base (the `BASE_LAG_UPGRADES` build argument), read from the Dockerfile.
 */
export function runtimeBaseLag(dockerfile) {
  const lines = dockerfile.split("\n");
  const from = lines.findIndex((line) =>
    /^FROM\s+\S+\s+AS\s+runtime\s*$/i.test(line),
  );
  if (from < 0) throw new Error("The Dockerfile has no runtime stage");
  const baseImage = lines[from].trim().split(/\s+/)[1];
  const next = lines.findIndex(
    (line, index) => index > from && /^FROM\s/i.test(line),
  );
  const stage = lines.slice(from, next < 0 ? undefined : next);
  const arg = stage
    .map((line) =>
      line.match(/^ARG\s+BASE_LAG_UPGRADES(?:=(?:"([^"]*)"|(\S*)))?\s*$/),
    )
    .find(Boolean);
  const value = arg ? (arg[1] ?? arg[2] ?? "") : "";
  return { baseImage, packages: value.split(/\s+/).filter(Boolean) };
}

/**
 * Problems with the packages upgraded past the base: each must be installed in
 * the base and have another version in the image. The same version in both
 * means the base has caught up (so the entry comes out) or the upgrade did not
 * apply. `baseVersions` and `imageVersions` map a package to its version, or
 * to null when it is not installed.
 */
export function baseLagProblems(packages, baseVersions, imageVersions) {
  const problems = [];
  for (const name of packages) {
    const base = baseVersions[name] ?? null;
    const image = imageVersions[name] ?? null;
    if (base === null) {
      problems.push(
        `BASE_LAG_UPGRADES names ${name}, which the base image does not install`,
      );
    } else if (image === base) {
      problems.push(
        `${name} is ${base} in both the base and the image: if the base now has the fix, remove ${name} from BASE_LAG_UPGRADES in the Dockerfile; otherwise the upgrade did not apply`,
      );
    }
  }
  return problems;
}

function debianVersions(image, packages) {
  const versions = {};
  for (const name of packages) {
    const result = spawnSync(
      "docker",
      [
        "run",
        "--rm",
        "--entrypoint",
        "dpkg-query",
        image,
        "-W",
        "-f=${Version}",
        name,
      ],
      { encoding: "utf8" },
    );
    versions[name] =
      result.status === 0 && result.stdout.trim() ? result.stdout.trim() : null;
  }
  return versions;
}

function checkBaseLag(image) {
  const { baseImage, packages } = runtimeBaseLag(
    readFileSync("Dockerfile", "utf8"),
  );
  if (packages.length === 0) {
    console.log("ok: the runtime stage upgrades no package past its base");
    return;
  }
  const baseVersions = debianVersions(baseImage, packages);
  const imageVersions = debianVersions(image, packages);
  const problems = baseLagProblems(packages, baseVersions, imageVersions);
  if (problems.length) throw new Error(problems.join("\n"));
  const upgraded = packages.map(
    (name) => `${name} ${baseVersions[name]} → ${imageVersions[name]}`,
  );
  console.log(`ok: upgraded past the base: ${upgraded.join(", ")}`);
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

    const storeEntries = docker(["exec", name, "ls", "/app/node_modules/.pnpm"])
      .split("\n")
      .filter(Boolean);
    const { pip } = JSON.parse(
      docker(["exec", name, "/usr/local/bin/python", "-c", importCheck, "pip"]),
    );
    const development = developmentPackageProblems(storeEntries, pip);
    if (development.length) throw new Error(development.join("\n"));
    console.log(
      `ok: node_modules has no ${DEVELOPMENT_PACKAGES.join(", ")}, and the system Python cannot import pip`,
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
 * workflow use this default, so a local run checks the same budget. Lowered from
 * 5.25 on 2026-11-22 (US-94.3), once EPIC-94 took torch out of the image: it
 * measured 3.82 GB on amd64 and 3.72 GB on arm64. Change it only as a decision,
 * noted in the release notes.
 */
export const DEFAULT_MAX_SIZE_GB = "4.25";

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
  checkBaseLag(values.image);
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
