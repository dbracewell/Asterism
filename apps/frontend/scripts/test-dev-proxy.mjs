// Verify real Next.js rewrites for HTTP and WebSocket upgrades without user data.
// Requires free ports 8000 and 30999. Run from apps/frontend with Node 22.13+.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

const origin = "http://127.0.0.1:30999";
const backend = createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({ path: req.url, authorization: req.headers.authorization }),
  );
});
backend.on("upgrade", (req, socket) => {
  const accept = createHash("sha1")
    .update(
      req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
    )
    .digest("base64");
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  const message = Buffer.from(req.url);
  socket.write(Buffer.concat([Buffer.from([0x81, message.length]), message]));
  socket.on("data", () => socket.end(Buffer.from([0x88, 0])));
  socket.on("error", () => socket.destroy());
});

let next;
let output = "";
try {
  backend.listen(8000, "127.0.0.1");
  await once(backend, "listening");
  next = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "--port", "30999"],
    {
      cwd: new URL("../", import.meta.url),
      env: {
        ...process.env,
        PUBLIC_URL: origin,
        BETTER_AUTH_SECRET: "dev-proxy-test-only-secret-at-least-32-chars",
        BETTER_AUTH_DB_PATH: ":memory:",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  next.stdout.on("data", (data) => {
    output += data;
  });
  next.stderr.on("data", (data) => {
    output += data;
  });
  let response;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (next.exitCode !== null) throw new Error(`Next.js exited: ${output}`);
    try {
      response = await fetch(`${origin}/api/py/probe?value=1`, {
        headers: { Authorization: "Bearer test-token" },
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) break;
    } catch {
      /* wait for startup */
    }
    await delay(500);
  }
  assert.ok(response?.ok, output);
  assert.deepEqual(await response.json(), {
    path: "/api/py/probe?value=1",
    authorization: "Bearer test-token",
  });

  // Collection routes must retain their slash and Authorization header rather
  // than bouncing between Next.js normalization and FastAPI's slash redirect.
  for (const path of ["/api/py/chat/", "/api/py/folders/", "/api/py/settings/user"]) {
    const result = await fetch(`${origin}${path}`, {
      headers: { Authorization: "Bearer test-token" },
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(result.status, 200, `${path} unexpectedly redirected or failed`);
    assert.deepEqual(await result.json(), {
      path,
      authorization: "Bearer test-token",
    });
  }

  await new Promise((resolve, reject) => {
    const socket = new WebSocket(
      "ws://127.0.0.1:30999/api/py/chat/stream/test?token=test",
    );
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("WebSocket proxy timeout"));
    }, 10000);
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("WebSocket proxy failed"));
    });
    socket.addEventListener("message", (event) => {
      clearTimeout(timer);
      socket.close();
      try {
        assert.equal(event.data, "/api/py/chat/stream/test?token=test");
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
  console.log(
    "PASS: Next.js same-origin HTTP, authorization forwarding, and WebSocket proxy",
  );
} finally {
  if (next && next.exitCode === null) {
    const exited = once(next, "exit");
    next.kill("SIGTERM");
    const timer = setTimeout(() => next.kill("SIGKILL"), 10000);
    await exited;
    clearTimeout(timer);
  }
  backend.closeAllConnections();
  backend.close();
}
