// A disposable Asterism container sized like the target host (US-86.7).
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { parseDockerSize } from "./stats.mjs";

const run = promisify(execFile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function docker(...args) {
  const { stdout } = await run("docker", args, { maxBuffer: 256 * 1024 * 1024 });
  return stdout.trim();
}

/**
 * Start the image on a fresh volume with `cpus` and `memory` limits.
 * Every address is trusted as a proxy, so the run chooses each person's client
 * address with X-Forwarded-For (one shared school address, or one each).
 */
export async function startInstance({ image, cpus, memory, port, environment = {} }) {
  const suffix = randomBytes(4).toString("hex");
  const name = `asterism-capacity-${suffix}`;
  const volume = `${name}-storage`;
  const secrets = Object.fromEntries(
    ["BETTER_AUTH_SECRET", "SYSTEM_KEY", "ADMIN_PASSPHRASE"].map((key) => [key, randomBytes(32).toString("base64url")]),
  );
  const publicUrl = `http://127.0.0.1:${port}`;
  const variables = {
    PUBLIC_URL: publicUrl,
    TRUSTED_PROXIES: "0.0.0.0/0,::/0",
    LOG_FORMAT: "json",
    ...secrets,
    ...environment,
  };
  await docker(
    "run",
    "-d",
    "--name",
    name,
    "--cpus",
    String(cpus),
    "--memory",
    memory,
    "--memory-swap",
    memory,
    "--add-host",
    "host.docker.internal:host-gateway",
    "-p",
    `127.0.0.1:${port}:3000`,
    "-v",
    `${volume}:/storage`,
    ...Object.entries(variables).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
    image,
  );
  const instance = { name, volume, publicUrl, base: publicUrl, secrets };
  try {
    await waitHealthy(name);
  } catch (error) {
    error.message += `\n${(await logs(name)).split("\n").slice(-30).join("\n")}`;
    await removeInstance(instance);
    throw error;
  }
  return instance;
}

async function waitHealthy(name) {
  for (let index = 0; index < 180; index += 1) {
    const [state] = JSON.parse(await docker("inspect", name)).map((entry) => entry.State);
    if (!state.Running) throw new Error(`${name} exited before becoming healthy`);
    if (state.Health?.Status === "healthy") return;
    await sleep(2000);
  }
  throw new Error(`${name} did not become healthy`);
}

export async function logs(name) {
  const { stdout, stderr } = await run("docker", ["logs", name], { maxBuffer: 512 * 1024 * 1024 });
  return `${stdout}\n${stderr}`;
}

/** Memory in use and CPU percent (100 = one core) right now. */
export async function sample(name) {
  const line = await docker("stats", "--no-stream", "--format", "{{.MemUsage}}|{{.CPUPerc}}", name);
  const [usage, cpu] = line.split("|");
  return { memory: parseDockerSize(usage.split("/")[0]), cpu: Number.parseFloat(cpu) };
}

/** The container's peak memory from its cgroup, when the kernel reports it. */
export async function peakMemory(name) {
  try {
    return Number(await docker("exec", name, "cat", "/sys/fs/cgroup/memory.peak"));
  } catch {
    return null;
  }
}

export async function removeInstance({ name, volume }) {
  await docker("rm", "-f", name).catch(() => {});
  await docker("volume", "rm", "-f", volume).catch(() => {});
}
