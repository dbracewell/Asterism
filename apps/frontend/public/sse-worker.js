const ports = new Set();
let eventSource = null;

function initSSE() {
  if (eventSource) return;

  // Relative or absolute stream endpoint
  eventSource = new EventSource("/api/stream");

  eventSource.onmessage = (event) => {
    broadcast({ type: "message", data: event.data });
  };

  eventSource.onerror = () => {
    broadcast({ type: "error", data: "SSE error" });
    eventSource.close();
    eventSource = null;
    setTimeout(() => {
      initSSE();
    }, 2000);
  };
}

function broadcast(payload) {
  ports.forEach((port) => {
    try {
      port.postMessage(payload);
    } catch {
      ports.delete(port);
    }
  });
}

self.onconnect = (event) => {
  const port = event.ports[0];
  ports.add(port);
  port.start();

  port.onmessage = (e) => {
    if (e.data === "unload") {
      ports.delete(port);
      if (ports.size === 0 && eventSource) {
        eventSource.close();
        eventSource = null;
      }
    }
  };

  initSSE();
};
