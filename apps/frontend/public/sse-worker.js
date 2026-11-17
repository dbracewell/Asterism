const ports = new Set();
let eventSource = null;
let reconnectTimer = null;

const RECONNECT_DELAY_MS = 2000;

function initSSE() {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  // No tab is listening: stay closed until one connects again.
  if (eventSource || ports.size === 0) return;

  // Relative or absolute stream endpoint
  eventSource = new EventSource("/api/stream");

  eventSource.onmessage = (event) => {
    broadcast({ type: "message", data: event.data });
  };

  eventSource.onerror = () => {
    broadcast({ type: "error", data: "SSE error" });
    if (!eventSource) return;
    eventSource.close();
    eventSource = null;
    if (ports.size > 0) {
      reconnectTimer = setTimeout(initSSE, RECONNECT_DELAY_MS);
    }
  };
}

/** Closes the stream and cancels any pending reconnect once no tab is left. */
function closeIfIdle() {
  if (ports.size > 0) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

function removePort(port) {
  ports.delete(port);
  closeIfIdle();
}

function broadcast(payload) {
  ports.forEach((port) => {
    try {
      port.postMessage(payload);
    } catch {
      removePort(port);
    }
  });
}

self.onconnect = (event) => {
  const port = event.ports[0];
  ports.add(port);
  port.start();

  port.onmessage = (e) => {
    if (e.data === "unload") removePort(port);
  };

  initSSE();
};
