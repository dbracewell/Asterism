// One simulated person: cookies, client address, tokens, API calls and chat sockets (US-86.7).
import { randomUUID } from "node:crypto";

/** Every request the run made, by label: status counts and durations. */
export class Metrics {
  constructor() {
    this.requests = new Map();
    this.events = [];
  }

  request(label, status, ms) {
    const entry = this.requests.get(label) ?? { statuses: {}, durations: [] };
    entry.statuses[status] = (entry.statuses[status] ?? 0) + 1;
    entry.durations.push(ms);
    this.requests.set(label, entry);
  }

  event(kind, fields) {
    this.events.push({ kind, at: Date.now(), ...fields });
  }

  of(kind) {
    return this.events.filter((event) => event.kind === kind);
  }
}

export class HttpError extends Error {
  constructor(label, status, body) {
    super(`${label}: ${status} ${body.slice(0, 200)}`);
    this.status = status;
    this.body = body;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function tokenExpiry(token) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).exp * 1000;
  } catch {
    return 0;
  }
}

/**
 * A signed-in browser.
 *
 * `tokens` copies how the app gets a backend token: "per-request" fetches
 * `/api/auth/token` before every backend call; "cached" reuses one until a
 * minute before it expires.
 */
export class Session {
  constructor({ base, publicUrl, address, metrics, tokens = "cached" }) {
    this.base = base;
    this.publicUrl = publicUrl;
    this.address = address;
    this.metrics = metrics;
    this.tokens = tokens;
    this.cookies = new Map();
    this.cachedToken = null;
  }

  headers(extra = {}) {
    const headers = { Origin: this.publicUrl, ...extra };
    if (this.address) headers["X-Forwarded-For"] = this.address;
    if (this.cookies.size) {
      headers.Cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    }
    return headers;
  }

  /** One request; records its status and duration under `label`. Network failures record status 0. */
  async fetch(label, path, { method = "GET", json, body, headers = {} } = {}) {
    const started = performance.now();
    let response;
    try {
      response = await fetch(this.base + path, {
        method,
        redirect: "manual",
        headers: this.headers({ ...(json !== undefined && { "Content-Type": "application/json" }), ...headers }),
        body: json !== undefined ? JSON.stringify(json) : body,
        signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      this.metrics.request(label, 0, performance.now() - started);
      throw error;
    }
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (value) this.cookies.set(name, value);
      else this.cookies.delete(name);
    }
    const text = await response.text();
    this.metrics.request(label, response.status, performance.now() - started);
    return { status: response.status, headers: response.headers, text };
  }

  async json(label, path, options) {
    const result = await this.fetch(label, path, options);
    if (result.status < 200 || result.status >= 300) throw new HttpError(label, result.status, result.text);
    return result.text ? JSON.parse(result.text) : null;
  }

  async token() {
    if (this.tokens === "cached" && this.cachedToken && tokenExpiry(this.cachedToken) - 60_000 > Date.now()) {
      return this.cachedToken;
    }
    const { token } = await this.json("auth token", "/api/auth/token");
    this.cachedToken = token;
    return token;
  }

  /** A backend call the way the browser's API client makes it. */
  async api(label, method, path, json, extraHeaders) {
    const token = await this.token();
    return this.json(label, `/api/py${path}`, {
      method,
      json,
      headers: { Authorization: `Bearer ${token}`, ...extraHeaders },
    });
  }

  async upload(label, filename, content, type = "text/plain") {
    const token = await this.token();
    const form = new FormData();
    form.append("files", new Blob([content], { type }), filename);
    return this.json(label, "/api/py/files/", {
      method: "POST",
      body: form,
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  /** A server-rendered page; redirects count as rendered. */
  async page(label, path) {
    const result = await this.fetch(label, path);
    if (result.status >= 400) throw new HttpError(label, result.status, result.text);
  }

  /** Sign in like a person: on "too many requests", wait and retry until `giveUpMs`. */
  async signIn(email, password, { giveUpMs = 180_000 } = {}) {
    const started = Date.now();
    let attempts = 0;
    let limited = 0;
    for (;;) {
      attempts += 1;
      const result = await this.fetch("auth sign-in", "/api/auth/sign-in/email", {
        method: "POST",
        json: { email, password },
      });
      if (result.status === 200) {
        return { ok: true, attempts, limited, ms: Date.now() - started };
      }
      if (result.status !== 429 || Date.now() - started > giveUpMs) {
        return { ok: false, attempts, limited, ms: Date.now() - started, status: result.status };
      }
      limited += 1;
      // People retry after a few seconds rather than waiting out the whole hint.
      const hint = Number(result.headers.get("x-retry-after") ?? result.headers.get("retry-after") ?? 5);
      await sleep(Math.min(Math.max(hint, 2), 10) * 1000 + Math.random() * 2000);
    }
  }

  async openChat(chatId) {
    const socket = new ChatSocket(this, chatId);
    await socket.open();
    return socket;
  }
}

/** One chat page's socket: tracks the first token and completion of each turn. */
export class ChatSocket {
  constructor(session, chatId) {
    this.session = session;
    this.chatId = chatId;
    this.waiter = null;
    this.closed = null;
  }

  async open() {
    let token;
    try {
      token = await this.session.token();
    } catch (error) {
      this.closed = { code: 0, reason: error.message };
      throw error;
    }
    const url = new URL(`/api/py/chat/stream/${this.chatId}`, this.session.base.replace(/^http/, "ws"));
    url.searchParams.set("token", token);
    const started = performance.now();
    this.socket = new WebSocket(url, { headers: this.session.headers() });
    this.socket.onmessage = (message) => this.receive(JSON.parse(message.data));
    this.socket.onclose = (event) => {
      this.closed = { code: event.code, reason: event.reason };
      this.waiter?.settle({ error: `closed ${event.code} ${event.reason}`.trim() });
    };
    await new Promise((resolve, reject) => {
      this.socket.onopen = () => {
        this.session.metrics.request("chat socket", 101, performance.now() - started);
        resolve();
      };
      this.socket.onerror = () => {
        this.session.metrics.request("chat socket", 0, performance.now() - started);
        this.closed ??= { code: 0, reason: "failed to open" };
        reject(new Error("chat socket failed to open"));
      };
    });
    this.socket.onerror = () => {};
  }

  receive(packet) {
    const waiter = this.waiter;
    if (!waiter) return;
    if (packet.type === "delta" && waiter.firstToken == null) waiter.firstToken = performance.now();
    if (packet.type === "complete") waiter.settle({});
    if (packet.type === "error") {
      waiter.settle({ error: packet.error_code ?? packet.reason ?? "error", content: packet.content });
    }
  }

  /** Wait for the turn that is starting now; resolves when it completes or fails. */
  expectTurn(timeoutMs = 300_000) {
    let settle;
    const done = new Promise((resolve) => {
      settle = resolve;
    });
    const waiter = { firstToken: null, settle: null };
    const timer = setTimeout(() => waiter.settle({ error: "timeout" }), timeoutMs);
    waiter.settle = (result) => {
      clearTimeout(timer);
      if (this.waiter === waiter) this.waiter = null;
      settle({ ...result, firstToken: waiter.firstToken, finished: performance.now() });
    };
    this.waiter = waiter;
    return done;
  }

  send(command) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(command));
    else this.waiter?.settle({ error: "socket not open" });
  }

  close() {
    this.waiter?.settle({ error: "closed by client" });
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) this.socket.close();
  }
}

export const newRequestId = () => randomUUID();
