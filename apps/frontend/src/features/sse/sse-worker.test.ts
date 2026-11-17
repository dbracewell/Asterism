import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// The shared worker is a plain script served from public/; run it in a fake
// worker scope with a fake EventSource.
const source = readFileSync(
  path.resolve(__dirname, "../../../public/sse-worker.js"),
  "utf8",
);

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
}

type Port = {
  start: () => void;
  postMessage: ReturnType<typeof vi.fn>;
  onmessage: ((event: { data: unknown }) => void) | null;
};

let scope: { onconnect: (event: { ports: Port[] }) => void };

function connect(postMessage = vi.fn()): Port {
  const port: Port = { start: vi.fn(), postMessage, onmessage: null };
  scope.onconnect({ ports: [port] });
  return port;
}

const unload = (port: Port) => port.onmessage?.({ data: "unload" });
const open = () => FakeEventSource.instances.filter((es) => !es.closed);

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.instances = [];
  scope = {} as typeof scope;
  new Function("self", "EventSource", source)(scope, FakeEventSource);
});

afterEach(() => vi.useRealTimers());

it("shares one stream between tabs and closes it with the last tab", () => {
  const first = connect();
  const second = connect();
  expect(FakeEventSource.instances).toHaveLength(1);

  FakeEventSource.instances[0].onmessage?.({ data: "hello" });
  expect(first.postMessage).toHaveBeenCalledWith({
    type: "message",
    data: "hello",
  });
  expect(second.postMessage).toHaveBeenCalledWith({
    type: "message",
    data: "hello",
  });

  unload(first);
  expect(open()).toHaveLength(1);
  unload(second);
  expect(open()).toHaveLength(0);
});

it("reconnects after an error while a tab is open", () => {
  connect();
  FakeEventSource.instances[0].onerror?.();
  expect(open()).toHaveLength(0);

  vi.advanceTimersByTime(2000);
  expect(FakeEventSource.instances).toHaveLength(2);
  expect(open()).toHaveLength(1);
});

it("cancels the pending reconnect when the last tab unloads", () => {
  const port = connect();
  FakeEventSource.instances[0].onerror?.();
  unload(port);

  vi.advanceTimersByTime(10_000);
  expect(FakeEventSource.instances).toHaveLength(1);
  expect(open()).toHaveLength(0);
});

it("stops when the only tab's port is dead, and restarts for a new tab", () => {
  const dead = vi.fn(() => {
    throw new Error("port closed");
  });
  connect(dead);
  FakeEventSource.instances[0].onerror?.();

  vi.advanceTimersByTime(10_000);
  expect(FakeEventSource.instances).toHaveLength(1);
  expect(open()).toHaveLength(0);

  connect();
  expect(FakeEventSource.instances).toHaveLength(2);
  expect(open()).toHaveLength(1);
  // The reconnect timer was cancelled, so no extra stream appears later.
  vi.advanceTimersByTime(10_000);
  expect(FakeEventSource.instances).toHaveLength(2);
});
