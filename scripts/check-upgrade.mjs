#!/usr/bin/env node
// US-91.6: upgrading from the previous release keeps an instance's data.
//
//   pnpm check:upgrade [--to asterism:local] [--from <image>]
//
// Starts the previous release's image on a fresh volume and seeds it through
// the API: an admin account, a model provider (a local double), a chat with a
// reply, two related files indexed into vectors, a custom theme, local
// captioning switched on with an image captioned by it, and the ONNX image
// generator saved as the generator. Then it
// stops it and starts the new image on the same volume with the same secrets,
// and checks the container is healthy, both databases were migrated (the auth
// schema matches a fresh one from the new image), and the account, chat, files
// (their bytes, and their vectors through similar-file search), theme (every
// value) and stored caption are all still there, and that local captioning
// still captions a new image (US-94.1: an upgrade may replace the caption
// model bundle, which the new image then downloads itself), and that the saved
// ONNX generator is still saved and still offered by the new image (US-94.4;
// every build has it), and that a user memory and a project memory are
// unchanged (US-93.6; seeded only when the previous image has memory, which
// 0.3.1 and earlier don't). Last, it starts
// the previous image again on the
// upgraded volume and checks it refuses the newer database with its version
// message, rather than running on it.
//
// The previous release is the newest v<version> tag behind this commit whose
// image, ghcr.io/dbracewell/asterism:<version>, was published: a release whose
// workflow failed keeps its tag but has no image, so the one before it is
// used. With none yet, the check says so and passes. Containers, the volume and the double are removed
// afterwards.
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { AUTH_TABLES } from "./check-image.mjs";
import {
  ChatSocket,
  HttpError,
  Metrics,
  Session,
} from "./capacity/session.mjs";
import { startStubProvider } from "./capacity/stub-provider.mjs";
import { latestRelease } from "./release.mjs";

export const REGISTRY_IMAGE = "ghcr.io/dbracewell/asterism";
const PASSWORD = "Upgrade-check-91!";
const PYTHON = "/app/apps/backend/.venv/bin/python";
const THEME_ID = "upgrade-check";
// The image generator every build has since 0.3.0 (US-94.4). The 0.2.x upgrade
// seeded Diffusers, which the CPU image left out (US-94.2); 0.3.0 can't save it.
const LOCAL_GENERATOR = "ONNX";
// A bundled theme the previous image serves, saved again as a custom one.
const BASE_THEME = "atlas";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (message) => console.log(message);

/**
 * The releases that could be upgraded from, newest first: the `v*` tags
 * reachable from this commit, leaving out the commit's own tags (a release
 * commit upgrades from the one before it).
 */
export function previousReleases({ reachable, atHead }) {
  const own = new Set(atHead);
  const versions = [];
  let remaining = reachable.filter((tag) => !own.has(tag));
  for (let next; (next = latestRelease(remaining));) {
    versions.push(next);
    remaining = remaining.filter((tag) => tag.replace(/^v/, "") !== next);
  }
  return versions;
}

/**
 * The newest of `versions` with a published image, or null. `lookup` answers
 * the registry's status for a version's manifest: only 404 (never published)
 * moves on to an older release; anything else but 200 is an error.
 */
export async function publishedRelease(versions, lookup, note = () => {}) {
  for (const version of versions) {
    const status = await lookup(version);
    if (status === 200) return version;
    if (status !== 404) {
      throw new Error(
        `The registry answered ${status} for ${REGISTRY_IMAGE}:${version}`,
      );
    }
    note(
      `${REGISTRY_IMAGE}:${version} was never published (its release failed); trying the release before it`,
    );
  }
  return null;
}

/** The registry's status for a version's manifest, asked anonymously. */
async function manifestStatus(version) {
  const repository = REGISTRY_IMAGE.replace(/^ghcr\.io\//, "");
  const auth = await fetch(
    `https://ghcr.io/token?scope=repository:${repository}:pull`,
  );
  if (!auth.ok)
    throw new Error(`ghcr.io refused a pull token (${auth.status})`);
  const { token } = await auth.json();
  const response = await fetch(
    `https://ghcr.io/v2/${repository}/manifests/${version}`,
    {
      method: "HEAD",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: [
          "application/vnd.oci.image.index.v1+json",
          "application/vnd.docker.distribution.manifest.list.v2+json",
        ].join(", "),
      },
    },
  );
  return response.status;
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
  for (const filename of Object.keys(seeded.files)) {
    if (!found.files.includes(filename))
      problems.push(`The file ${filename} is missing`);
    else if (found.contents[filename] !== seeded.files[filename])
      problems.push(`The file ${filename} no longer has the uploaded content`);
  }
  if (found.knowledge !== "ready")
    problems.push(`The file's knowledge is ${found.knowledge}, not ready`);
  const [first, second] = Object.keys(seeded.files);
  if (!found.similar.includes(second)) {
    problems.push(
      `Similar-file search for ${first} no longer finds ${second}, so its vectors were lost (found ${JSON.stringify(found.similar)})`,
    );
  }
  if (found.caption !== seeded.caption.text) {
    problems.push(
      `The caption of ${seeded.caption.filename} changed: seeded ${JSON.stringify(seeded.caption.text)}, found ${JSON.stringify(found.caption)}`,
    );
  }
  if (found.newCaption?.status !== "ready" || !found.newCaption.payload?.text) {
    problems.push(
      `Local captioning no longer captions: ${JSON.stringify(found.newCaption)}`,
    );
  }
  if (found.generator !== seeded.generator) {
    problems.push(
      `The saved image generator changed: seeded ${seeded.generator}, found ${found.generator}`,
    );
  } else if (
    /not available in this image/.test(found.generatorStatus?.detail ?? "")
  ) {
    problems.push(
      `The saved ${seeded.generator} generator is no longer in this image: ${JSON.stringify(found.generatorStatus)}`,
    );
  }
  for (const memory of seeded.memories ?? []) {
    const kept = found.memories?.find(({ id }) => id === memory.id);
    if (!kept)
      problems.push(`The ${memory.kind} memory ${memory.id} is missing`);
    else if (JSON.stringify(kept) !== JSON.stringify(memory)) {
      problems.push(
        `The ${memory.kind} memory changed: seeded ${JSON.stringify(memory)}, found ${JSON.stringify(kept)}`,
      );
    }
  }
  // A release that deliberately changes the theme format changes this too.
  if (!found.theme)
    problems.push(`The theme ${seeded.theme.filename} is missing`);
  else if (JSON.stringify(found.theme) !== JSON.stringify(seeded.theme)) {
    problems.push(
      `The theme changed: seeded ${JSON.stringify(seeded.theme)}, found ${JSON.stringify(found.theme)}`,
    );
  }
  return problems;
}

/** How an upgraded schema differs from a fresh one, or null. */
export function schemaProblem(expected, upgraded) {
  const differences = [];
  for (const [table, shape] of Object.entries(expected)) {
    if (!upgraded[table]) differences.push(`missing table ${table}`);
    else if (JSON.stringify(upgraded[table]) !== JSON.stringify(shape)) {
      differences.push(
        `${table} is ${JSON.stringify(upgraded[table])}, not ${JSON.stringify(shape)}`,
      );
    }
  }
  return differences.length
    ? `The auth database is not at the image's schema:\n  ${differences.join("\n  ")}`
    : null;
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

// Every table's columns and every index of a SQLite database, in a stable order.
const schemaDump = String.raw`
import json, sqlite3, sys
with sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True) as connection:
    schema = {}
    for (table,) in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"):
        # By name: a column added by ALTER TABLE comes last, not where CREATE puts it.
        columns = sorted(
            [c[1], c[2].upper(), c[3], c[4], c[5]]
            for c in connection.execute(f'PRAGMA table_info("{table}")')
        )
        # Implicit indexes enforce UNIQUE and PRIMARY KEY constraints, so they
        # count too; only their generated names (numbered by the order SQLite
        # made them) are left out. Each index: name, unique, origin (c, u or
        # pk), partial, and its columns in order.
        indexes = sorted(
            [
                "" if i[1].startswith("sqlite_autoindex_") else i[1],
                i[2],
                i[3],
                i[4],
                [c[2] for c in connection.execute(f'PRAGMA index_info("{i[1]}")')],
            ]
            for i in connection.execute(f'PRAGMA index_list("{table}")')
        )
        schema[table] = {"columns": columns, "indexes": indexes}
print(json.dumps(schema))
`;

/**
 * Whether the upgraded auth database has the schema the image's own Better
 * Auth migration gives a fresh database: run it on a scratch file in the
 * container, as the entrypoint runs it on /storage/users.db, and compare.
 */
function authSchemaProblem(name) {
  const fresh = "/tmp/upgrade-check-auth.db";
  docker([
    "exec",
    "-w",
    "/app/apps/frontend",
    name,
    "env",
    "-u",
    "SYSTEM_KEY",
    "-u",
    "ADMIN_PASSPHRASE",
    "-u",
    "DB_URL",
    `BETTER_AUTH_DB_PATH=${fresh}`,
    "ASTERISM_CONFIG_PROFILE=auth-migrate",
    "node",
    "node_modules/auth/dist/index.mjs",
    "migrate",
    "--config",
    "./src/lib/auth-cli.ts",
    "--yes",
  ]);
  const dump = (path) =>
    JSON.parse(docker(["exec", name, PYTHON, "-c", schemaDump, path]));
  const expected = dump(fresh);
  const upgraded = dump("/storage/users.db");
  docker(["exec", name, "rm", "-f", fresh]);
  return schemaProblem(expected, upgraded);
}

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
// script can't call it. The data is a bundled theme the previous image itself
// serves, renamed, so it is in that release's format.
const themeSeed = String.raw`
import json, os, sys
theme = json.load(sys.stdin)
os.makedirs("/storage/themes", exist_ok=True)
path = "/storage/themes/${THEME_ID}.json"
with open(path, "w") as target:
    json.dump(theme, target, indent=2)
os.chmod(path, 0o600)
`;

/** A theme as the app serves it, or null when it doesn't know it. */
async function readTheme(base, id) {
  const response = await fetch(`${base}/api/theme?name=${id}`);
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(`GET /api/theme?name=${id} answered ${response.status}`);
  return response.json();
}

function notes(topic) {
  const line = `Lecture notes on ${topic}: the light reactions split water, release oxygen and make ATP and NADPH for the Calvin cycle. `;
  return line.repeat(40);
}

// Two 128 px PNGs for local captioning: a red square and a blue circle.
const CAPTION_IMAGES = {
  "red-square.png":
    "iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAABMXPacAAAA3klEQVR42u3UsQ3AIBAEQWPRB4H7L4mASo4mXkIWswUQ3OhpSR6d6zUBAAACAEAAAAgAAAEAIAAABACAAAAQAAACAEAAAKi+XvXQHOO27b61XIAvSAAACAAAAQAgAAAEAIAAABAAAAIAQAAACAAAAQAgAAAEAIAAABAAAAIAAIAAABAAAAIAQAAACAAAAQAgAAAEAIAAABAAAAIAQAAACAAAAQAgAAAEAIAAABAAAAIAQAAACAAAAQAgAH+oJbGCCwAgAAAEAIAAABAAAAIAQAAACAAAAQAgAAAEAICK23z2CfuTg9ObAAAAAElFTkSuQmCC",
  "blue-circle.png":
    "iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAABMXPacAAAB4ElEQVR42u3dwW0DMQxEUZlIHzmkjlTvOnJIJU4LBrIrUuSbc4Bw+DUUvLCXj9frtShPoQUAAEAAAEAAAEAAAEAAAEAAAEAAAEAAAEAAAEAAAEAAAEDX6+Oscj+/f975s9/n1ymOHvW/mPVm0w+FURfAP/t+ColyAC7ve3EShQBsaH1BDCUAbG59KQwxufvp/z05AenmK0QhdD+3ntD93Kp2j6CarU8cR6H7uXWG7udWG7qfW7PH0av/B7ETj/+2ykP3c+sP3c914Q7oewf0OP53ewndz3VkBHUcQf2O/32+JKBdAroe/5vcSYCvJgJg/iR6lAAjCADzJ9GpBBhBAFAHAHMugGv9SoARBAABAAABAAABAAABAAABAMBq9lKSVfWHfBJgBAFATQDMuQYudCoBRhAAplCiRwkwggAwhRLdSUDHEdQ1BHf4koCml3C/ENzkKIa8IbisFyOo9eeAHiG41UWMelV5wfpjznvKa1buDpjxLOjEEOypOaYtTKhWbQxcWlGqzpz9AWV/0bf/iMTMxSF1qoqxy1uK1JO/xCd9HOUehRh79IoE0R6xBYBNessuSQBsU132CQOwPA0lAAAgAAAgAAAgAAAgAAAgAAAgAAAgAAAgAAAgAAAgAHroD6ZxvcPlK76MAAAAAElFTkSuQmCC",
};

/** Wait for the local caption model bundle to be ready; returns its last status. */
async function waitCaptionModel(session) {
  const deadline = Date.now() + 20 * 60 * 1000;
  let status = "timeout";
  while (Date.now() < deadline) {
    ({ status } = await session.api(
      "caption model",
      "GET",
      "/settings/app/caption-model/status",
    ));
    if (status === "ready" || status === "failed") return status;
    await sleep(5000);
  }
  return status;
}

/** Upload one of CAPTION_IMAGES and wait for its caption; returns the captioning entry. */
async function captionImage(session, filename) {
  await session.upload(
    "upload image",
    filename,
    Buffer.from(CAPTION_IMAGES[filename], "base64"),
    "image/png",
  );
  const deadline = Date.now() + 10 * 60 * 1000;
  let captioning = { status: "timeout" };
  while (Date.now() < deadline) {
    try {
      const knowledge = await session.api(
        "knowledge",
        "GET",
        `/files/${encodeURIComponent(filename)}/knowledge`,
      );
      captioning = knowledge.extractions?.captioning ?? captioning;
      if (captioning.status === "ready" || captioning.status === "failed")
        return captioning;
    } catch (error) {
      if (!(error instanceof HttpError && [404, 429].includes(error.status)))
        throw error;
    }
    await sleep(3000);
  }
  return captioning;
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

// The memory fields an upgrade must keep (US-93.6).
const MEMORY_FIELDS = [
  "id",
  "kind",
  "project_id",
  "text",
  "category",
  "sensitive",
  "revision",
];
const memoryFields = (memory) =>
  Object.fromEntries(MEMORY_FIELDS.map((field) => [field, memory[field]]));

/** A user memory and a project memory, or null when the image has no memory API. */
async function seedMemories(session) {
  try {
    await session.api("memories", "GET", "/users/me/memories/");
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  }
  const project = await session.api("project", "POST", "/projects/", {
    name: "Upgrade check project",
  });
  const memories = [
    {
      kind: "user",
      text: "Uses a screen reader; describe images in words",
      category: "accessibility",
      sensitive: true,
    },
    {
      kind: "project",
      project_id: project.id,
      text: "The lab report is due every Friday",
    },
  ];
  const saved = [];
  for (const memory of memories)
    saved.push(
      memoryFields(
        await session.api("memory", "POST", "/users/me/memories/", memory),
      ),
    );
  return saved;
}

async function readMemories(session) {
  const page = await session.api(
    "memories",
    "GET",
    "/users/me/memories/?page_size=100",
  );
  return page.items.map(memoryFields);
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
    systemKey: run.secrets.SYSTEM_KEY,
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
    throw new Error(`The seeded chat has no reply: ${JSON.stringify(chat)}`);
  }

  const files = Object.fromEntries(
    ["light-reactions.txt", "calvin-cycle.txt"].map((filename) => [
      filename,
      notes(filename),
    ]),
  );
  for (const [filename, text] of Object.entries(files)) {
    await session.upload("upload", filename, text);
    const status = await waitIndexed(session, filename);
    if (status !== "ready")
      throw new Error(`${filename} was not indexed: ${status}`);
  }

  await session.api("captioning", "PUT", "/settings/app/captioning", {
    mode: "local",
  });
  await session.api(
    "caption model",
    "POST",
    "/settings/app/caption-model/download",
  );
  const captionModel = await waitCaptionModel(session);
  if (captionModel !== "ready")
    throw new Error(`The previous image's caption model is ${captionModel}`);
  const captioned = await captionImage(session, "red-square.png");
  if (captioned.status !== "ready" || !captioned.payload?.text)
    throw new Error(
      `The previous image did not caption: ${JSON.stringify(captioned)}`,
    );
  const caption = {
    filename: "red-square.png",
    text: captioned.payload.text,
  };

  // The previous image includes local image generation; saving it is enough.
  await session.api(
    "image generator",
    "PUT",
    "/settings/app/image_generator_provider",
    { value: { name: LOCAL_GENERATOR, parameters: {} } },
  );

  const base = await readTheme(run.base, BASE_THEME);
  if (!base) throw new Error(`The previous image has no ${BASE_THEME} theme`);
  const { filename: _filename, ...data } = base;
  void _filename;
  docker(["exec", "-i", run.containers.at(-1), PYTHON, "-c", themeSeed], {
    input: JSON.stringify({ ...data, name: "Upgrade check" }),
  });
  const theme = await readTheme(run.base, THEME_ID);
  if (!theme)
    throw new Error("The previous image does not read the seeded theme");
  const memories = await seedMemories(session);

  return {
    email,
    chatId: created.info.id,
    chat,
    files,
    theme,
    caption,
    generator: LOCAL_GENERATOR,
    memories,
  };
}

async function inspectSeed(run, seeded) {
  const session = new Session({
    base: run.base,
    publicUrl: run.base,
    metrics: new Metrics(),
  });
  const signedIn = (await session.signIn(seeded.email, PASSWORD)).ok;
  if (!signedIn)
    return { signedIn, files: [], contents: {}, similar: [], theme: null };
  const chat = chatSnapshot(
    await session.api("chat", "GET", `/chat/${seeded.chatId}`),
  );
  const listed = await session.api("files", "GET", "/files/");
  const files = listed.files.map((file) => file.filename);
  const contents = {};
  for (const filename of Object.keys(seeded.files)) {
    const download = await session.fetch(
      "download",
      `/api/py/files/${encodeURIComponent(filename)}`,
      { headers: { Authorization: `Bearer ${await session.token()}` } },
    );
    if (download.status === 200) contents[filename] = download.text;
  }
  const [first] = Object.keys(seeded.files);
  const knowledge = (
    await session.api(
      "knowledge",
      "GET",
      `/files/${encodeURIComponent(first)}/knowledge`,
    )
  ).status;
  const similar = (
    await session.api(
      "similar",
      "GET",
      `/files/${encodeURIComponent(first)}/similar`,
    )
  ).files.map((match) => match.file.filename);
  const stored = (
    await session.api(
      "knowledge",
      "GET",
      `/files/${encodeURIComponent(seeded.caption.filename)}/knowledge`,
    )
  ).extractions?.captioning?.payload?.text;
  const model = await waitCaptionModel(session);
  const fresh =
    model === "ready"
      ? await captionImage(session, "blue-circle.png")
      : { status: `not tried: the caption model is ${model}` };
  const generator =
    (await session.api("settings", "GET", "/settings/app"))
      .image_generator_provider?.name ?? null;
  const generatorStatus = await session.api(
    "image generator status",
    "GET",
    "/settings/app/image-generation/status",
  );
  return {
    signedIn,
    chat,
    files,
    contents,
    knowledge,
    similar,
    theme: await readTheme(run.base, THEME_ID),
    caption: stored ?? null,
    newCaption: fresh,
    generator,
    generatorStatus,
    memories: seeded.memories ? await readMemories(session) : null,
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
      `ok: seeded an admin, a chat with ${seeded.chat.length} messages, ${Object.keys(seeded.files).length} indexed files, a theme, a local caption and the ONNX image generator (schema ${before.revision})`,
    );
    log(
      seeded.memories
        ? `ok: seeded ${seeded.memories.length} memories, one about the person and one for a project`
        : `skip: ${from} has no memory, so memories are seeded from the first release that has it`,
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
    const auth = authSchemaProblem(next);
    if (auth) throw new Error(auth);
    if (after.revision !== after.head) {
      throw new Error(
        `The backend database is at ${after.revision}, not the image's ${after.head}`,
      );
    }
    log(
      `ok: both databases migrated: the auth schema matches a fresh one, and the backend went ${before.revision} → ${after.revision}`,
    );
    const problems = seedProblems(seeded, await inspectSeed(run, seeded));
    if (problems.length) throw new Error(problems.join("\n"));
    log(
      `ok: the account signs in; the chat, the files' bytes and vectors, every theme value${seeded.memories ? ", the memories" : ""} and the caption are unchanged, local captioning captions a new image, and the saved ONNX generator is still offered`,
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
        if (output.includes(secret))
          console.error("A secret appeared in the logs");
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
    const candidates = previousReleases({
      reachable: git("tag", "--list", "v*", "--merged", "HEAD"),
      atHead: git("tag", "--points-at", "HEAD"),
    });
    const version = await publishedRelease(candidates, manifestStatus, log);
    if (!version) {
      log(
        candidates.length
          ? "skip: no release before this commit has a published image, so there is nothing to upgrade from"
          : "skip: no release precedes this commit yet, so there is nothing to upgrade from",
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
