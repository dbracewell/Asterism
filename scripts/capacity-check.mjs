#!/usr/bin/env node
// Capacity check (US-86.7): a class of students on one disposable, size-limited
// container with a model double that streams like a hosted model.
//
//   node scripts/capacity-check.mjs [--students 30] [--duration 600] [--cpus 4] [--memory 8g]
//
// See docs/architecture/capacity.md for the scenario, the targets and results.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { logs, peakMemory, removeInstance, sample, startInstance } from "./capacity/instance.mjs";
import { ChatSocket, HttpError, Metrics, Session, newRequestId } from "./capacity/session.mjs";
import { gib, percentile, seconds, summarize } from "./capacity/stats.mjs";
import { startStubProvider } from "./capacity/stub-provider.mjs";

const { values: options } = parseArgs({
  options: {
    image: { type: "string", default: "asterism:local" },
    students: { type: "string", default: "30" },
    duration: { type: "string", default: "600" },
    arrival: { type: "string", default: "60" },
    "burst-at": { type: "string" },
    "think-min": { type: "string", default: "20" },
    "think-max": { type: "string", default: "60" },
    cpus: { type: "string", default: "4" },
    memory: { type: "string", default: "8g" },
    port: { type: "string", default: "3900" },
    addresses: { type: "string", default: "shared" },
    tokens: { type: "string", default: "cached" },
    "model-ttft-ms": { type: "string", default: "700" },
    "model-tps": { type: "string", default: "40" },
    "reply-tokens": { type: "string", default: "250" },
    env: { type: "string", multiple: true, default: [] },
    out: { type: "string" },
    keep: { type: "boolean", default: false },
  },
});

const STUDENTS = Number(options.students);
const DURATION_MS = Number(options.duration) * 1000;
const ARRIVAL_MS = Number(options.arrival) * 1000;
const BURST_AT_MS = (options["burst-at"] != null ? Number(options["burst-at"]) : Number(options.duration) / 2) * 1000;
const THINK = [Number(options["think-min"]) * 1000, Number(options["think-max"]) * 1000];
const SCHOOL_ADDRESS = "203.0.113.10";
const PASSWORD = "Capacity-check-86!";
if (!["shared", "each"].includes(options.addresses)) throw new Error("--addresses is shared or each");
if (!["cached", "per-request"].includes(options.tokens)) throw new Error("--tokens is cached or per-request");

// Pass/fail lines for the report. Durations in ms, memory in bytes.
const TARGETS = {
  signInP95: 15_000,
  steadyFirstTokenP95: 3_000,
  burstFirstTokenP95: 5_000,
  indexedP95: 120_000,
  peakMemory: 6 * 1024 ** 3,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const between = ([low, high]) => low + Math.random() * (high - low);
const metrics = new Metrics();
const out = resolve(options.out ?? join(".capacity", new Date().toISOString().replace(/[:.]/g, "-")));
mkdirSync(out, { recursive: true });
const log = (message) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${message}`);

function notes(seed, size = 40_000) {
  const line = `Lecture notes ${seed}: the light reactions split water, release oxygen and make ATP and NADPH. `;
  return line.repeat(Math.ceil(size / line.length)).slice(0, size);
}

async function signUp(session, name, admin) {
  const query = new URLSearchParams({ adminKey: instance.secrets.ADMIN_PASSPHRASE, systemKey: instance.secrets.SYSTEM_KEY, role: admin ? "admin" : "user" });
  const email = `${name}-${newRequestId().slice(0, 8)}@capacity.test`;
  const { user } = await session.json("setup sign-up", `/api/auth/sign-up/email?${query}`, {
    method: "POST",
    json: { name, email, password: PASSWORD },
  });
  await session.json("setup provision", "/api/py/users/", {
    method: "POST",
    json: { user_id: user.id, system_key: instance.secrets.SYSTEM_KEY },
  });
  return email;
}

async function waitIndexed(session, filename, label) {
  const started = Date.now();
  while (Date.now() - started < 600_000) {
    try {
      const status = await session.api(label, "GET", `/files/${encodeURIComponent(filename)}/knowledge`);
      if (status.status === "ready" || status.status === "failed") return { status: status.status, ms: Date.now() - started };
    } catch (error) {
      // Not yet listed, or refused for now: the page keeps polling, like a browser.
      if (!(error instanceof HttpError && [404, 429].includes(error.status))) throw error;
    }
    await sleep(3000);
  }
  return { status: "timeout", ms: Date.now() - started };
}

// --- Setup -------------------------------------------------------------------------

const stub = await startStubProvider({
  host: "0.0.0.0",
  ttftMs: Number(options["model-ttft-ms"]),
  tokensPerSecond: Number(options["model-tps"]),
  replyTokens: Number(options["reply-tokens"]),
});
const environment = Object.fromEntries(options.env.map((entry) => entry.split(/=(.*)/s).slice(0, 2)));
log(`Starting ${options.image} with ${options.cpus} CPUs and ${options.memory} (${Object.keys(environment).join(", ") || "default settings"})`);
const instance = await startInstance({
  image: options.image,
  cpus: options.cpus,
  memory: options.memory,
  port: Number(options.port),
  environment,
});
let exitCode = 0;
process.on("unhandledRejection", (error) => {
  metrics.event("error", { message: `unhandled: ${error?.message ?? error}` });
});
// An interrupted run still removes its container and volume.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    if (!options.keep) await removeInstance(instance);
    process.exit(130);
  });
}
try {
  const session = (address) =>
    new Session({ base: instance.base, publicUrl: instance.publicUrl, address, metrics, tokens: options.tokens });
  const admin = session("198.51.100.1");
  await signUp(admin, "capacity-admin", true);
  const providerId = newRequestId();
  await admin.api("setup admin", "PUT", "/settings/app/providers", {
    llm_providers: [
      {
        id: providerId,
        name: "Capacity double",
        provider_type: "generic_openai",
        base_url: `http://host.docker.internal:${stub.port}/v1`,
        api_key: "capacity-check-key",
      },
    ],
  });
  await admin.api("setup admin", "POST", `/settings/app/providers/${providerId}/models/discover`);
  const catalog = await admin.api("setup admin", "GET", `/settings/app/providers/${providerId}/models`);
  const model = catalog.models[0];
  await admin.api("setup admin", "PUT", `/settings/app/providers/${providerId}/models/${model.id}`, {
    is_active: true,
    supports_tools: true,
    supports_vision: false,
    context_window: 32768,
  });

  log(`Creating ${STUDENTS} students, each with a project and a deck`);
  const students = [];
  for (let index = 0; index < STUDENTS; index += 5) {
    await Promise.all(
      Array.from({ length: Math.min(5, STUDENTS - index) }, async (_, offset) => {
        const number = index + offset;
        const browser = session(`198.51.100.${10 + number}`);
        const email = await signUp(browser, `student-${number}`, false);
        const project = await browser.api("setup study", "POST", "/projects/", { name: `Biology ${number}` });
        const deck = await browser.api("setup study", "POST", `/projects/${project.id}/study/decks`, { name: "Photosynthesis" });
        for (let card = 0; card < 8; card += 1) {
          await browser.api("setup study", "POST", `/projects/${project.id}/study/decks/${deck.id}/cards`, {
            front: `Card ${card}: what does stage ${card} produce?`,
            back: "ATP and NADPH",
          });
        }
        students[number] = { number, email, project: project.id, deck: deck.id, chat: null, socket: null, uploads: 0, turns: 0 };
      }),
    );
  }

  // The embedding model downloads on first start; uploads during the class should
  // measure indexing, not the download.
  log("Waiting for file indexing to be ready");
  const probe = await admin.upload("setup upload", "probe.txt", notes("probe", 2000));
  const probed = await waitIndexed(admin, probe.files[0].filename, "setup upload");
  if (probed.status !== "ready") throw new Error(`The probe upload was not indexed: ${probed.status}`);

  // --- The class -------------------------------------------------------------------

  log(`Class starts: ${STUDENTS} students over ${DURATION_MS / 1000} s, burst at ${BURST_AT_MS / 1000} s`);
  metrics.requests.clear();
  const started = Date.now();
  const deadline = started + DURATION_MS;
  let burst;
  const burstFired = new Promise((resolve) => {
    burst = resolve;
  });
  const burstTimer = BURST_AT_MS > 0 ? setTimeout(burst, BURST_AT_MS) : null;
  let burstOn = false;
  burstFired.then(() => {
    burstOn = true;
    log("Burst: everyone asks at once");
  });
  const samples = [];
  let monitoring = true;
  const background = [];
  const monitor = (async () => {
    while (Date.now() < deadline + 30_000 && monitoring) {
      const [container, status] = await Promise.all([
        sample(instance.name).catch(() => null),
        admin.api("admin status", "GET", "/status").catch(() => null),
      ]);
      samples.push({
        at: Date.now() - started,
        memory: container?.memory ?? null,
        cpu: container?.cpu ?? null,
        replies: status?.active_chat_runs.used ?? null,
        connections: status?.chat_connections.used ?? null,
        knowledge: status ? status.knowledge_running + status.knowledge_queued : null,
      });
      await sleep(5000);
    }
  })();

  async function chatTurn(student, browser, phase) {
    const prompt = `Explain step ${student.turns} of photosynthesis to student ${student.number}.`;
    student.turns += 1;
    const t0 = performance.now();
    let turn;
    let refusals = 0;
    try {
      if (!student.chat || Math.random() < 0.3) {
        student.socket?.close();
        student.socket = null;
        const chat = await browser.api("chat create", "POST", "/chat/", {
          request_id: newRequestId(),
          user_prompt: prompt,
          model_id: model.id,
        });
        student.chat = { id: chat.info.id };
        await browser.page("page chat", `/c/${chat.info.id}`);
        const socket = (student.socket = new ChatSocket(browser, chat.info.id));
        turn = socket.expectTurn();
        await socket.open();
      } else {
        const chat = await browser.api("chat read", "GET", `/chat/${student.chat.id}`);
        await browser.api("chat send", "POST", `/chat/${student.chat.id}/message`, {
          request_id: newRequestId(),
          user_prompt: prompt,
          parent_message_id: chat.messages.at(-1)?.id ?? null,
          expected_model_revision: chat.info.model_revision,
        });
        await browser.api("chat read", "GET", `/chat/${student.chat.id}`);
        if (!student.socket || student.socket.closed) {
          student.socket = await browser.openChat(student.chat.id);
        }
        turn = student.socket.expectTurn();
        student.socket.send({ type: "resume" });
      }
      let result = await turn;
      // Capacity refusals are retryable; the page offers a retry, people take it.
      while (result.error === "chat_capacity" && refusals < 5) {
        refusals += 1;
        await sleep(3000);
        turn = student.socket.expectTurn();
        student.socket.send({ type: "resume" });
        result = await turn;
      }
      metrics.event("turn", {
        phase,
        firstToken: result.firstToken != null ? result.firstToken - t0 : null,
        total: result.finished - t0,
        error: result.error ?? null,
        refusals,
      });
      // A failed turn leaves a message waiting; the person starts a new chat.
      if (result.error) student.chat = null;
      else await browser.api("chat read", "GET", `/chat/${student.chat.id}`);
    } catch (error) {
      metrics.event("turn", { phase, firstToken: null, total: performance.now() - t0, error: error.message, refusals });
      student.chat = null;
    }
  }

  async function upload(student, browser) {
    student.uploads += 1;
    const name = `notes-${student.number}-${student.uploads}.txt`;
    const t0 = performance.now();
    try {
      const { files } = await browser.upload("file upload", name, notes(`${student.number}-${student.uploads}`));
      metrics.event("upload", { ms: performance.now() - t0 });
      // The library polls the file's status while it is indexed.
      background.push(
        waitIndexed(browser, files[0].filename, "file status").then(
          (result) => metrics.event("indexed", result),
          (error) => metrics.event("indexed", { status: `error: ${error.message}`, ms: null }),
        ),
      );
    } catch (error) {
      metrics.event("upload", { ms: performance.now() - t0, error: error.message });
    }
  }

  async function study(student, browser) {
    const base = `/projects/${student.project}/study`;
    const queue = await browser.api("study", "GET", `${base}/decks/${student.deck}/review?limit=5`);
    if (!queue.items.length) {
      for (let card = 0; card < 2; card += 1) {
        await browser.api("study", "POST", `${base}/decks/${student.deck}/cards`, {
          front: `New card ${Date.now()}`,
          back: "Chlorophyll",
        });
      }
    }
    for (const card of queue.items) {
      await sleep(between([2000, 5000]));
      await browser.api("study", "POST", `${base}/decks/${student.deck}/cards/${card.id}/reviews`, {
        rating: ["again", "hard", "good", "easy"][Math.floor(Math.random() * 4)],
        expected_reps: card.reps,
      });
    }
    await browser.api("study", "GET", `${base}/progress`);
  }

  async function browse(browser) {
    await browser.api("browse", "GET", "/chat/?page=1&page_size=20");
    await browser.api("browse", "GET", "/files/");
    await browser.page("page home", "/");
  }

  async function attend(student) {
    await sleep(Math.random() * ARRIVAL_MS);
    const browser = session(options.addresses === "shared" ? SCHOOL_ADDRESS : `198.51.100.${10 + student.number}`);
    const signedIn = await browser.signIn(student.email, PASSWORD);
    metrics.event("signin", signedIn);
    if (!signedIn.ok) return;
    await browser.page("page home", "/").catch(() => {});
    let burstDone = false;
    while (Date.now() < deadline) {
      // Only an idle student who has not had the burst yet is woken by it.
      await Promise.race([sleep(between(THINK)), ...(burstDone ? [] : [burstFired])]);
      if (Date.now() >= deadline) break;
      if (burstOn && !burstDone) {
        burstDone = true;
        await sleep(Math.random() * 5000);
        await chatTurn(student, browser, "burst");
        continue;
      }
      const roll = Math.random();
      try {
        if (roll < 0.65) await chatTurn(student, browser, "steady");
        else if (roll < 0.75) await upload(student, browser);
        else if (roll < 0.95) await study(student, browser);
        else await browse(browser);
      } catch (error) {
        metrics.event("error", { message: error.message });
      }
    }
    student.socket?.close();
  }

  await Promise.all(students.map(attend));
  clearTimeout(burstTimer);
  log("Class over; waiting for indexing to finish");
  await Promise.race([Promise.all(background), sleep(300_000)]);
  monitoring = false;
  await monitor;

  // --- Report ----------------------------------------------------------------------

  const peak = await peakMemory(instance.name);
  const containerLogs = await logs(instance.name);
  const logLines = containerLogs.split("\n");
  const busy = logLines.filter((line) => /database is locked|SQLITE_BUSY|database table is locked/i.test(line));
  const errors = logLines
    .filter((line) => line.startsWith("{"))
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((line) => line && ["ERROR", "CRITICAL"].includes(line.level));
  const edgeLimited = logLines.filter((line) => line.includes("limiting requests")).length;

  const signIns = metrics.of("signin");
  const turns = metrics.of("turn");
  const phase = (name) => turns.filter((turn) => turn.phase === name);
  const firstTokens = (list) => list.filter((turn) => turn.firstToken != null).map((turn) => turn.firstToken);
  const uploads = metrics.of("upload");
  const indexed = metrics.of("indexed");
  const requests = Object.fromEntries(
    [...metrics.requests].map(([label, entry]) => [label, { statuses: entry.statuses, ...summarize(entry.durations) }]),
  );
  const count = (predicate) =>
    [...metrics.requests.values()].reduce(
      (total, entry) =>
        total + Object.entries(entry.statuses).reduce((sum, [status, n]) => sum + (predicate(Number(status)) ? n : 0), 0),
      0,
    );
  const memoryPeak = Math.max(peak ?? 0, ...samples.map((entry) => entry.memory ?? 0));
  const summary = {
    settings: {
      image: options.image,
      students: STUDENTS,
      durationSeconds: DURATION_MS / 1000,
      cpus: Number(options.cpus),
      memory: options.memory,
      addresses: options.addresses,
      tokens: options.tokens,
      model: { ttftMs: Number(options["model-ttft-ms"]), tokensPerSecond: Number(options["model-tps"]), replyTokens: Number(options["reply-tokens"]) },
      environment,
    },
    signIn: {
      ...summarize(signIns.map((entry) => entry.ms)),
      failed: signIns.filter((entry) => !entry.ok).length,
      limited: signIns.reduce((total, entry) => total + entry.limited, 0),
    },
    turns: Object.fromEntries(
      ["steady", "burst"].map((name) => [
        name,
        {
          ...summarize(firstTokens(phase(name))),
          started: phase(name).length,
          failed: phase(name).filter((turn) => turn.error).length,
          refusals: phase(name).reduce((total, turn) => total + turn.refusals, 0),
          totalP95: percentile(phase(name).map((turn) => turn.total), 95),
        },
      ]),
    ),
    turnErrors: [...new Set(turns.filter((turn) => turn.error).map((turn) => turn.error))].slice(0, 10),
    uploads: { ...summarize(uploads.map((entry) => entry.ms)), failed: uploads.filter((entry) => entry.error).length },
    indexed: {
      ...summarize(indexed.filter((entry) => entry.ms != null).map((entry) => entry.ms)),
      failed: indexed.filter((entry) => entry.status !== "ready").length,
    },
    http: {
      total: count(() => true),
      tooMany: count((status) => status === 429),
      serverErrors: count((status) => status >= 500),
      networkErrors: count((status) => status === 0),
    },
    requests,
    instance: {
      peakMemory: memoryPeak,
      cpuMaxPercent: Math.max(...samples.map((entry) => entry.cpu ?? 0)),
      cpuMeanPercent: samples.reduce((total, entry) => total + (entry.cpu ?? 0), 0) / Math.max(1, samples.length),
      maxRepliesRunning: Math.max(...samples.map((entry) => entry.replies ?? 0)),
      maxConnections: Math.max(...samples.map((entry) => entry.connections ?? 0)),
      maxKnowledgeJobs: Math.max(...samples.map((entry) => entry.knowledge ?? 0)),
      sqliteBusy: busy.length,
      errorLines: errors.length,
      errorMessages: [...new Set(errors.map((line) => `${line.logger}: ${line.message}`.slice(0, 160)))].slice(0, 10),
      edgeLimited,
    },
    provider: stub.stats(),
    actionErrors: [...new Set(metrics.of("error").map((entry) => entry.message.slice(0, 160)))].slice(0, 10),
  };

  const allFirstTokens = firstTokens(turns);
  const checks = [
    ["Every student signed in", summary.signIn.failed === 0 && signIns.length === STUDENTS],
    [`Sign-in p95 ≤ ${seconds(TARGETS.signInP95)}`, (summary.signIn.p95 ?? Infinity) <= TARGETS.signInP95],
    [`Steady first token p95 ≤ ${seconds(TARGETS.steadyFirstTokenP95)}`, (summary.turns.steady.p95 ?? Infinity) <= TARGETS.steadyFirstTokenP95],
    [
      `Burst first token p95 ≤ ${seconds(TARGETS.burstFirstTokenP95)}`,
      BURST_AT_MS <= 0 || (summary.turns.burst.p95 ?? Infinity) <= TARGETS.burstFirstTokenP95,
    ],
    ["Every turn finished", turns.every((turn) => !turn.error) && allFirstTokens.length === turns.length],
    ["No admission refusals", turns.every((turn) => turn.refusals === 0)],
    ["No refused requests (429)", summary.http.tooMany - summary.signIn.limited === 0],
    ["No server errors", summary.http.serverErrors === 0 && summary.http.networkErrors === 0],
    ["No SQLite busy errors", summary.instance.sqliteBusy === 0],
    [`Uploads indexed, p95 ≤ ${seconds(TARGETS.indexedP95)}`, summary.indexed.failed === 0 && (summary.indexed.p95 ?? 0) <= TARGETS.indexedP95],
    [`Peak memory ≤ ${gib(TARGETS.peakMemory)}`, memoryPeak <= TARGETS.peakMemory],
  ];
  summary.checks = Object.fromEntries(checks);
  exitCode = checks.every(([, ok]) => ok) ? 0 : 1;

  const row = (label, value) => `| ${label} | ${value} |`;
  const turnRow = (name) => {
    const entry = summary.turns[name];
    return `${entry.started} started, ${entry.failed} failed, ${entry.refusals} refusals; first token p50 ${seconds(entry.p50)}, p95 ${seconds(entry.p95)}, max ${seconds(entry.max)}; whole reply p95 ${seconds(entry.totalP95)}`;
  };
  const report = [
    `# Capacity check — ${STUDENTS} students, ${options.cpus} CPUs, ${options.memory}`,
    "",
    `Image \`${options.image}\`, ${DURATION_MS / 1000} s class, ${options.addresses} client address, ${options.tokens} tokens.`,
    `Model double: first token after ${options["model-ttft-ms"]} ms, ${options["model-tps"]} tokens/s, ${options["reply-tokens"]} tokens per reply.`,
    Object.keys(environment).length ? `Settings: ${Object.entries(environment).map(([key, value]) => `\`${key}=${value}\``).join(", ")}.` : "Default settings.",
    "",
    "| Measure | Result |",
    "| --- | --- |",
    row("Sign-in", `${signIns.length - summary.signIn.failed} of ${STUDENTS} signed in, ${summary.signIn.limited} refused attempts; p95 ${seconds(summary.signIn.p95)}, max ${seconds(summary.signIn.max)}`),
    row("Chat turns, steady", turnRow("steady")),
    row("Chat turns, burst", turnRow("burst")),
    row("Uploads", `${summary.uploads.count} (${summary.uploads.failed} failed), p95 ${seconds(summary.uploads.p95)}; indexed p95 ${seconds(summary.indexed.p95)}, ${summary.indexed.failed} not indexed`),
    row("HTTP requests", `${summary.http.total}: ${summary.http.tooMany} × 429, ${summary.http.serverErrors} × 5xx, ${summary.http.networkErrors} network errors`),
    row("Token requests", `${requests["auth token"]?.count ?? 0}, p95 ${seconds(requests["auth token"]?.p95)}`),
    row("Memory", `peak ${gib(memoryPeak)}`),
    row("CPU", `mean ${summary.instance.cpuMeanPercent.toFixed(0)} %, max ${summary.instance.cpuMaxPercent.toFixed(0)} % (100 % = one core)`),
    row("Replies running / connections", `max ${summary.instance.maxRepliesRunning} / ${summary.instance.maxConnections}; provider streams at once max ${summary.provider.maxActive}`),
    row("SQLite busy errors", summary.instance.sqliteBusy),
    row("Backend error lines", summary.instance.errorLines),
    row("Edge rate-limit log lines", summary.instance.edgeLimited),
    "",
    ...checks.map(([label, ok]) => `- ${ok ? "PASS" : "FAIL"} ${label}`),
    ...(summary.turnErrors.length ? ["", "Turn errors:", ...summary.turnErrors.map((error) => `- ${error}`)] : []),
    ...(summary.instance.errorMessages.length ? ["", "Error lines:", ...summary.instance.errorMessages.map((line) => `- ${line}`)] : []),
    ...(summary.actionErrors.length ? ["", "Action errors:", ...summary.actionErrors.map((line) => `- ${line}`)] : []),
    "",
  ].join("\n");
  writeFileSync(join(out, "summary.json"), `${JSON.stringify({ ...summary, samples }, null, 2)}\n`);
  writeFileSync(join(out, "summary.md"), report);
  writeFileSync(join(out, "container.log"), containerLogs);
  console.log(`\n${report}`);
  log(`Results in ${out}`);
} catch (error) {
  exitCode = 2;
  console.error(error);
} finally {
  if (options.keep) log(`Kept ${instance.name} at ${instance.base}`);
  else await removeInstance(instance);
  await stub.close();
}
process.exit(exitCode);
