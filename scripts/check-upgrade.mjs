#!/usr/bin/env node
// US-91.6: upgrading from the previous release keeps an instance's data.
//
//   pnpm check:upgrade [--to asterism:local] [--from <image>]
//
// Starts the previous release's image on a fresh volume and seeds it through
// the API: an admin account, a model provider (a local double), a chat with a
// reply, two related files indexed into vectors, and a custom theme. Then it
// stops it and starts the new image on the same volume with the same secrets,
// and checks the container is healthy, both databases were migrated, and the
// account, chat, files (their vectors too, through similar-file search) and
// theme are all still there. Last, it starts the previous image again on the
// upgraded volume and checks it refuses the newer database with its version
// message, rather than running on it.
//
// The previous release is the newest v<version> tag behind this commit; its
// image is ghcr.io/dbracewell/asterism:<version>. With none yet, the check
// says so and passes. Containers, the volume and the double are removed
// afterwards.
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { AUTH_TABLES } from "./check-image.mjs";
import { ChatSocket, HttpError, Metrics, Session } from "./capacity/session.mjs";
import { startStubProvider } from "./capacity/stub-provider.mjs";
import { latestRelease } from "./release.mjs";

export const REGISTRY_IMAGE = "ghcr.io/dbracewell/asterism";
const PASSWORD = "Upgrade-check-91!";
const PYTHON = "/app/apps/backend/.venv/bin/python";
const THEME_ID = "upgrade-check";
const BUNDLED_THEME = "apps/frontend/src/features/theme/bundled/atlas.json";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (message) => console.log(message);

/**
 * The release to upgrade from: the newest `v*` tag reachable from this commit,
 * leaving out the commit's own tags (a release commit upgrades from the one
 * before it). Null when there is none.
 */
export function previousRelease({ reachable, atHead }) {
  const own = new Set(atHead);
  return latestRelease(reachable.filter((tag) => !own.has(tag)));
}

/** What must survive of a chat: each message's id, role, status and text. */
export function chatSnapshot(chat) {
  return chat.messages.map(({ id, role, status, content }) => ({
    id,
    role,
    status,
    content,
  }));
}

/** The differences between what was seeded and what the upgrade kept. */
export function seedProblems(seeded, found) {
  const problems = [];
  if (!found.signedIn) problems.push(`${seeded.email} could not sign in`);
  if (JSON.stringify(found.chat) !== JSON.stringify(seeded.chat)) {
    problems.push(
      `The chat changed: seeded ${JSON.stringify(seeded.chat)}, found ${JSON.stringify(found.chat)}`,
    );
  }
  for (const filename of seeded.files) {
    if (!found.files.includes(filename))
      problems.push(`The file ${filename} is missing`);
  }
  if (found.knowledge !== "ready")
    problems.push(`The file's knowledge is ${found.knowledge}, not ready`);
  if (!found.similar.includes(seeded.files[1])) {
    problems.push(
      `Similar-file search for ${seeded.files[0]} no longer finds ${seeded.files[1]}, so its vectors were lost (found ${JSON.stringify(found.similar)})`,
    );
  }
  if (!found.themes.includes(seeded.theme))
    problems.push(`The theme ${seeded.theme} is missing`);
  return problems;
}

function docker(args, options = {}) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `docker ${args[0]} failed: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return result.stdout.trim();
}

const git = (...args) =>
  spawnSync("git", args, { encoding: "utf8" })
    .stdout.split("\n")
    .filter(Boolean);

function containerLogs(name) {
  const result = spawnSync("docker", ["logs", name], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return `${result.stdout}${result.stderr}`;
}

const state = (name) =>
  JSON.parse(docker(["inspect", "--format", "{{json .State}}", name]));

async function waitHealthy(name) {
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    const current = state(name);
    if (!current.Running) {
      throw new Error(
        `${name} exited (code ${current.ExitCode}) before becoming healthy`,
      );
    }
    if (current.Health?.Status === "healthy") return;
    await sleep(2000);
  }
  throw new Error(`${name} was not healthy within 10 minutes`);
}

async function waitExited(name) {
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const current = state(name);
    if (!current.Running) return current.ExitCode;
    if (current.Health?.Status === "healthy") return null;
    await sleep(2000);
  }
  return null;
}

/** Runs `image` on the shared volume; the caller removes it. */
function start(run, image, label) {
  const name = `${run.prefix}-${label}`;
  docker(
    [
      "run",
      "-d",
      "--name",
      name,
      "--stop-timeout",
      "30",
      "--add-host",
      "host.docker.internal:host-gateway",
      "-p",
      `127.0.0.1:${run.port}:3000`,
      "-v",
      `${run.volume}:/storage`,
      "-e",
      `PUBLIC_URL=${run.base}`,
      ...Object.keys(run.secrets).flatMap((key) => ["-e", key]),
      image,
    ],
    { env: { ...process.env, ...run.secrets } },
  );
  run.containers.push(name);
  return name;
}

function stop(name) {
  docker(["stop", name]);
  docker(["rm", name]);
}

const databaseCheck = String.raw`
import json, sqlite3
from asterism.db.migrate import head_revision
def tables(path):
    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as connection:
        return [row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")]
with sqlite3.connect("file:/storage/database.db?mode=ro", uri=True) as connection:
    revision = connection.execute("SELECT version_num FROM alembic_version").fetchone()
print(json.dumps({"auth": tables("/storage/users.db"), "revision": revision and revision[0], "head": head_revision()}))
`;

function databases(name) {
  return JSON.parse(
    docker([
      "exec",
      "-w",
      "/app/apps/backend",
      name,
      PYTHON,
      "-c",
      databaseCheck,
    ]),
  );
}

// Written the way the app's theme repository saves one: validated fields as
// JSON at /storage/themes/<id>.json, owned by the app's user. Themes are saved
// through a Next.js server action, whose id changes with every build, so a
// script can't call it; the app reading the file back is what is checked.
const themeSeed = String.raw`
import json, os, sys
theme = json.load(sys.stdin)
theme["name"] = "Upgrade check"
os.makedirs("/storage/themes", exist_ok=True)
path = "/storage/themes/${THEME_ID}.json"
with open(path, "w") as target:
    json.dump(theme, target, indent=2)
os.chmod(path, 0o600)
`;

async function themeIds(base) {
  const response = await fetch(`${base}/api/theme/list`);
  if (!response.ok)
    throw new Error(`GET /api/theme/list answered ${response.status}`);
  return (await response.json()).map((theme) => theme.filename);
}

function notes(topic) {
  const line = `Lecture notes on ${topic}: the light reactions split water, release oxygen and make ATP and NADPH for the Calvin cycle. `;
  return line.repeat(40);
}

async function waitIndexed(session, filename) {
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    try {
      const knowledge = await session.api(
        "knowledge",
        "GET",
        `/files/${encodeURIComponent(filename)}/knowledge`,
      );
      if (knowledge.status === "ready" || knowledge.status === "failed")
        return knowledge.status;
    } catch (error) {
      if (!(error instanceof HttpError && [404, 429].includes(error.status)))
        throw error;
    }
    await sleep(3000);
  }
  return "timeout";
}

async function seed(run, stub) {
  const session = new Session({
    base: run.base,
    publicUrl: run.base,
    metrics: new Metrics(),
  });
  const email = `upgrade-${randomUUID().slice(0, 8)}@upgrade.test`;
  const query = new URLSearchParams({
    adminKey: run.secrets.ADMIN_PASSPHRASE,
    role: "admin",
  });
  const { user } = await session.json(
    "sign-up",
    `/api/auth/sign-up/email?${query}`,
    {
      method: "POST",
      json: { name: "Upgrade check", email, password: PASSWORD },
    },
  );
  await session.json("provision", "/api/py/users/", {
    method: "POST",
    json: { user_id: user.id, system_key: run.secrets.SYSTEM_KEY },
  });

  const providerId = randomUUID();
  await session.api("provider", "PUT", "/settings/app/providers", {
    llm_providers: [
      {
        id: providerId,
        name: "Upgrade double",
        provider_type: "generic_openai",
        base_url: `http://host.docker.internal:${stub.port}/v1`,
        api_key: "upgrade-check-key",
      },
    ],
  });
  await session.api(
    "models",
    "POST",
    `/settings/app/providers/${providerId}/models/discover`,
  );
  const [model] = (
    await session.api(
      "models",
      "GET",
      `/settings/app/providers/${providerId}/models`,
    )
  ).models;
  await session.api(
    "model",
    "PUT",
    `/settings/app/providers/${providerId}/models/${model.id}`,
    {
      is_active: true,
      supports_tools: true,
      supports_vision: false,
      context_window: 32768,
    },
  );

  const created = await session.api("chat", "POST", "/chat/", {
    request_id: randomUUID(),
    user_prompt: "What do the light reactions make?",
    model_id: model.id,
  });
  const socket = new ChatSocket(session, created.info.id);
  const turn = socket.expectTurn();
  await socket.open();
  const result = await turn;
  socket.close();
  if (result.error) throw new Error(`The seeded chat failed: ${result.error}`);
  const chat = chatSnapshot(
    await session.api("chat", "GET", `/chat/${created.info.id}`),
  );
  if (chat.length < 2 || chat.at(-1).role !== "assistant") {
    throw new Error(
      `The seeded chat has no reply: ${JSON.stringify(chat)}`,
    );
  }

  const files = ["light-reactions.txt", "calvin-cycle.txt"];
  for (const filename of files) {
    await session.upload("upload", filename, notes(filename));
    const status = await waitIndexed(session, filename);
    if (status !== "ready")
      throw new Error(`${filename} was not indexed: ${status}`);
  }

  docker(["exec", "-i", run.containers.at(-1), PYTHON, "-c", themeSeed], {
    input: readFileSync(BUNDLED_THEME, "utf8"),
  });
  if (!(await themeIds(run.base)).includes(THEME_ID))
    throw new Error("The app does not list the seeded theme");

  return { email, chatId: created.info.id, chat, files, theme: THEME_ID };
}

async function inspectSeed(run, seeded) {
  const session = new Session({
    base: run.base,
    publicUrl: run.base,
    metrics: new Metrics(),
  });
  const signedIn = (await session.signIn(seeded.email, PASSWORD)).ok;
  if (!signedIn) return { signedIn, files: [], similar: [], themes: [] };
  const chat = chatSnapshot(
    await session.api("chat", "GET", `/chat/${seeded.chatId}`),
  );
  const listed = await session.api("files", "GET", "/files/");
  const files = (listed.files ?? listed).map((file) => file.filename);
  const knowledge = (
    await session.api(
      "knowledge",
      "GET",
      `/files/${encodeURIComponent(seeded.files[0])}/knowledge`,
    )
  ).status;
  const similar = (
    await session.api(
      "similar",
      "GET",
      `/files/${encodeURIComponent(seeded.files[0])}/similar`,
    )
  ).files.map((match) => match.file.filename);
  return {
    signedIn,
    chat,
    files,
    knowledge,
    similar,
    themes: await themeIds(run.base),
  };
}

async function check({ from, to, port }) {
  const prefix = `asterism-upgrade-${randomBytes(4).toString("hex")}`;
  const run = {
    prefix,
    port,
    base: `http://127.0.0.1:${port}`,
    volume: `${prefix}-storage`,
    containers: [],
    secrets: Object.fromEntries(
      ["BETTER_AUTH_SECRET", "SYSTEM_KEY", "ADMIN_PASSPHRASE"].map((key) => [
        key,
        randomBytes(32).toString("base64url"),
      ]),
    ),
  };
  const stub = await startStubProvider({
    host: "0.0.0.0",
    ttftMs: 100,
    tokensPerSecond: 200,
    replyTokens: 20,
  });
  try {
    docker(["volume", "create", run.volume]);

    log(`Starting the previous release, ${from}, on a fresh volume`);
    const old = start(run, from, "previous");
    await waitHealthy(old);
    const before = databases(old);
    const seeded = await seed(run, stub);
    log(
      `ok: seeded an admin, a chat with ${seeded.chat.length} messages, ${seeded.files.length} indexed files and a theme (schema ${before.revision})`,
    );
    stop(old);

    log(`Starting ${to} on the same volume`);
    const next = start(run, to, "upgraded");
    await waitHealthy(next);
    log("ok: the upgraded container is healthy");
    const after = databases(next);
    const missing = AUTH_TABLES.filter((table) => !after.auth.includes(table));
    if (missing.length)
      throw new Error(`The auth database lost tables: ${missing.join(", ")}`);
    if (after.revision !== after.head) {
      throw new Error(
        `The backend database is at ${after.revision}, not the image's ${after.head}`,
      );
    }
    log(
      `ok: both databases migrated (schema ${before.revision} → ${after.revision})`,
    );
    const problems = seedProblems(seeded, await inspectSeed(run, seeded));
    if (problems.length) throw new Error(problems.join("\n"));
    log(
      "ok: the account signs in, and the chat, files, their vectors and the theme are all there",
    );
    stop(next);

    if (before.head === after.head) {
      log(
        `skip: ${from} and ${to} share schema ${after.head}, so there is no newer database for the previous image to refuse`,
      );
      return;
    }
    log(`Starting ${from} again on the upgraded volume`);
    const back = start(run, from, "downgrade");
    const code = await waitExited(back);
    const output = containerLogs(back);
    if (code == null || code === 0) {
      throw new Error(
        `${from} ran on the upgraded volume instead of refusing it`,
      );
    }
    if (!/which this code does not know/.test(output)) {
      throw new Error(
        `${from} exited (code ${code}) without its version message:\n${output.split("\n").slice(-20).join("\n")}`,
      );
    }
    log(
      `ok: ${from} refuses the upgraded volume: "${output.match(/The backend database is at schema revision[^\n]*/)?.[0] ?? "which this code does not know"}"`,
    );
  } catch (error) {
    const last = run.containers.at(-1);
    if (last) {
      const output = containerLogs(last);
      console.error(
        `--- ${last} logs ---\n${output.split("\n").slice(-60).join("\n")}`,
      );
      for (const secret of Object.values(run.secrets)) {
        if (output.includes(secret)) console.error("A secret appeared in the logs");
      }
    }
    throw error;
  } finally {
    for (const name of run.containers)
      spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
    spawnSync("docker", ["volume", "rm", "-f", run.volume], {
      stdio: "ignore",
    });
    await stub.close();
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      to: { type: "string", default: "asterism:local" },
      from: { type: "string" },
      port: { type: "string", default: "3910" },
    },
  });
  let from = values.from;
  if (!from) {
    const version = previousRelease({
      reachable: git("tag", "--list", "v*", "--merged", "HEAD"),
      atHead: git("tag", "--points-at", "HEAD"),
    });
    if (!version) {
      log(
        "skip: no release precedes this commit yet, so there is nothing to upgrade from",
      );
      return;
    }
    from = `${REGISTRY_IMAGE}:${version}`;
    log(`Pulling the previous release, ${from}`);
    docker(["pull", "--quiet", from]);
  }
  for (const image of [from, values.to]) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/.test(image))
      throw new Error(`Not an image name: ${image}`);
    docker(["image", "inspect", image]);
  }
  await check({ from, to: values.to, port: Number(values.port) });
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
